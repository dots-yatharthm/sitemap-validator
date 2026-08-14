import zlib from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import * as cheerio from "cheerio";
import {
  absoluteUrl,
  isHtmlContent,
  isXmlContent
} from "./utils.js";

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

function maybeGunzip(body, url, contentType) {
  const looksGzip =
    body.length >= 2 &&
    body[0] === 0x1f &&
    body[1] === 0x8b;

  if (
    !looksGzip &&
    !/gzip/i.test(contentType) &&
    !/\.gz$/i.test(new URL(url).pathname)
  ) {
    return body;
  }

  try {
    return zlib.gunzipSync(body);
  } catch (error) {
    throw new Error(
      `Gzip sitemap detected but decompression failed: ${error.message}`
    );
  }
}

/*
 * IMPORTANT:
 * Yoast sitemap responses commonly contain:
 *
 * <?xml version="1.0" encoding="UTF-8"?>
 * <?xml-stylesheet type="text/xsl" href="...xsl"?>
 * <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
 *
 * fast-xml-parser can expose the XML declaration as "?xml" depending on
 * parser settings/version. We therefore remove XML declarations and
 * processing instructions BEFORE identifying the root element.
 */
function removeProcessingInstructions(text) {
  return text
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, "")
    .trim();
}

function detectXmlRoot(text) {
  const cleaned = removeProcessingInstructions(text);
  const match = cleaned.match(
    /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s|>)/s
  );

  if (!match) {
    return undefined;
  }

  return {
    rootName: match[1],
    cleaned
  };
}

function makeXmlEvidence(url, text, rootName, namespace, validation) {
  const lines = text.split(/\r?\n/);
  let focusLine = 1;

  if (validation && typeof validation === "object") {
    focusLine = Number(validation.err?.line ?? validation.line ?? 1);
  }

  const start = Math.max(1, focusLine - 3);
  const end = Math.min(lines.length, focusLine + 3);
  const snippet = [];

  for (let i = start; i <= end; i++) {
    snippet.push({
      line: i,
      text: lines[i - 1] ?? ""
    });
  }

  return {
    url,
    rootName: rootName ?? "",
    namespace: namespace ?? "",
    validationError: validation === true ? "" : JSON.stringify(validation ?? {}),
    focusLine,
    snippet
  };
}

function getAttributeFromRoot(rootXml, attribute) {
  const match = rootXml.match(
    new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i")
  );

  return match?.[1];
}

function firstValue(value) {
  if (typeof value === "string") return value.trim();

  if (Array.isArray(value)) {
    return firstValue(value[0]);
  }

  if (value && typeof value === "object") {
    if ("#text" in value) {
      return firstValue(value["#text"]);
    }

    if ("#cdata" in value) {
      return firstValue(value["#cdata"]);
    }
  }

  return undefined;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
      const normalized = entity.toLowerCase();

      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";

      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      return match;
    });
}

function cleanXmlText(value) {
  return decodeXmlEntities(
    value
      .replace(/^<!\[CDATA\[/i, "")
      .replace(/\]\]>$/i, "")
      .trim()
  );
}

/*
 * Standard sitemap <url><loc> extraction fallback.
 *
 * Some sitemap generators (especially extension-heavy WordPress sitemaps)
 * can produce valid XML that fast-xml-parser represents differently from
 * ordinary <url><loc> entries. We therefore keep the XML parser as the
 * primary parser, but use the validated XML source itself as a lossless
 * fallback when the parser returns fewer URL entries than the actual
 * <url><loc> blocks. This prevents silent URL-count loss while preserving
 * the existing parser behavior for normal sitemaps.
 */
function extractRawUrlEntries(url, cleanedXml) {
  const entries = [];
  const urlBlocks = cleanedXml.match(/<url\b[^>]*>[\s\S]*?<\/url>/gi) ?? [];

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i);
    if (!locMatch) continue;

    const rawLoc = cleanXmlText(locMatch[1]);
    const resolved = absoluteUrl(rawLoc, url);
    if (!resolved) continue;

    const getTag = (tag) => {
      const match = block.match(
        new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i")
      );
      return match ? cleanXmlText(match[1]) : undefined;
    };

    entries.push({
      loc: resolved,
      lastmod: getTag("lastmod"),
      changefreq: getTag("changefreq"),
      priority: getTag("priority"),
      sourceSitemap: url
    });
  }

  return entries;
}

function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseXml(url, text) {
  const rootInfo = detectXmlRoot(text);

  if (!rootInfo) {
    return {
      type: "xml-unknown",
      entries: [],
      childSitemaps: [],
      wellFormed: false,
      namespaceValid: false,
      errors: ["Unable to identify XML root element."],
      evidence: [makeXmlEvidence(url, text)]
    };
  }

  const { rootName, cleaned } = rootInfo;

  if (rootName !== "urlset" && rootName !== "sitemapindex") {
    return {
      type: "xml-unknown",
      entries: [],
      childSitemaps: [],
      wellFormed: false,
      namespaceValid: false,
      errors: [
        `Unsupported XML root element: <${rootName}>`
      ],
      evidence: [makeXmlEvidence(url, text, rootName)]
    };
  }

  const namespace = getAttributeFromRoot(
    cleaned.match(
      new RegExp(
        `<${rootName}\\b[^>]*>`,
        "is"
      )
    )?.[0] ?? "",
    "xmlns"
  );

  const namespaceValid =
    namespace === SITEMAP_NS;

  const validation =
    XMLValidator.validate(cleaned);

  if (validation !== true) {
    return {
      type:
        rootName === "sitemapindex"
          ? "xml-index"
          : "xml-urlset",
      entries: [],
      childSitemaps: [],
      wellFormed: false,
      namespaceValid,
      errors: [
        `Invalid XML: ${JSON.stringify(validation)}`
      ],
      evidence: [makeXmlEvidence(url, text, rootName, namespace, validation)]
    };
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
    processEntities: false
  });

  let doc;

  try {
    doc = parser.parse(cleaned);
  } catch (error) {
    return {
      type:
        rootName === "sitemapindex"
          ? "xml-index"
          : "xml-urlset",
      entries: [],
      childSitemaps: [],
      wellFormed: false,
      namespaceValid,
      errors: [`XML parse error: ${error.message}`],
      evidence: [makeXmlEvidence(url, text, rootName, namespace)]
    };
  }

  const root = doc[rootName];

  if (!root) {
    return {
      type:
        rootName === "sitemapindex"
          ? "xml-index"
          : "xml-urlset",
      entries: [],
      childSitemaps: [],
      wellFormed: false,
      namespaceValid,
      errors: [
        `Expected <${rootName}> root but parser returned no matching root.`
      ],
      evidence: [makeXmlEvidence(url, text, rootName, namespace)]
    };
  }

  if (rootName === "sitemapindex") {
    const childSitemaps = [];

    for (const item of asArray(root.sitemap)) {
      const loc = firstValue(item?.loc);
      if (!loc) continue;

      const resolved = absoluteUrl(loc, url);
      if (resolved) childSitemaps.push(resolved);
    }

    return {
      type: "xml-index",
      entries: [],
      childSitemaps,
      wellFormed: true,
      namespaceValid,
      errors: namespaceValid
        ? []
        : [
            `Unexpected XML namespace: ${namespace ?? "(missing)"}`
          ],
      evidence: namespaceValid ? [] : [makeXmlEvidence(url, text, rootName, namespace)]
    };
  }

  const parsedEntries = [];

  for (const item of asArray(root.url)) {
    const loc = firstValue(item?.loc);

    if (!loc) continue;

    const resolved = absoluteUrl(loc, url);

    parsedEntries.push({
      loc: resolved ?? loc,
      lastmod: firstValue(item?.lastmod),
      changefreq: firstValue(item?.changefreq),
      priority: firstValue(item?.priority),
      sourceSitemap: url
    });
  }

  const rawEntries = extractRawUrlEntries(url, cleaned);
  const entries = rawEntries.length > parsedEntries.length
    ? rawEntries
    : parsedEntries;

  return {
    type: "xml-urlset",
    entries,
    childSitemaps: [],
    wellFormed: true,
    namespaceValid,
    errors: namespaceValid
      ? []
      : [
          `Unexpected XML namespace: ${namespace ?? "(missing)"}`
        ]
  };
}

function parseHtml(url, text) {
  const $ = cheerio.load(text);

  const selectors = [
    "main",
    "[role='main']",
    "article",
    ".main-content",
    ".content",
    "#content",
    ".sitemap",
    "#sitemap"
  ];

  let root = $();

  for (const selector of selectors) {
    const found = $(selector).first();

    if (found.length) {
      root = found;
      break;
    }
  }

  if (!root.length) {
    root = $("body").first();
  }

  root
    .find(
      "header, nav, footer, aside, script, style, noscript"
    )
    .remove();

  const entries = [];

  root.find("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const absolute = absoluteUrl(href, url);
    if (!absolute) return;

    try {
      const parsed = new URL(absolute);

      if (parsed.protocol !== "https:") return;

      entries.push({
        loc: parsed.toString(),
        sourceSitemap: url
      });
    } catch {}
  });

  return {
    type: "html",
    entries,
    childSitemaps: [],
    wellFormed: true,
    namespaceValid: true,
    errors: [],
    evidence: []
  };
}

export function parseSitemap(url, body, contentType) {
  const decompressed = maybeGunzip(
    body,
    url,
    contentType
  );

  const text = decompressed
    .toString("utf8")
    .replace(/^\uFEFF/, "");

  if (
    isHtmlContent(contentType) ||
    /^\s*<!doctype html/i.test(text) ||
    /^\s*<html[\s>]/i.test(text)
  ) {
    return parseHtml(url, text);
  }

  if (!isXmlContent(contentType, url)) {
    return {
      type: "html",
      entries: [],
      childSitemaps: [],
      wellFormed: false,
      namespaceValid: false,
      errors: [
        `Unsupported sitemap content type: ${contentType || "(missing)"}`
      ],
      evidence: []
    };
  }

  return parseXml(url, text);
}
