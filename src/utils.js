import crypto from "node:crypto";

export function normalizeBaseUrl(input) {
  const url = new URL(input);

  if (url.protocol !== "https:") {
    throw new Error(`Base URL must use https: ${input}`);
  }

  if (url.search || url.hash) {
    throw new Error(`Base URL must not contain query/hash: ${input}`);
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  return url.toString();
}

export function absoluteUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

export function contentTypeOf(headers) {
  return (headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

export function isXmlContent(contentType, url) {
  return contentType.includes("xml") ||
    /\.xml(?:\.gz)?$/i.test(new URL(url).pathname);
}

export function isHtmlContent(contentType) {
  return contentType.includes("text/html") ||
    contentType.includes("application/xhtml");
}

export function isValidIso8601(value) {
  if (!value?.trim()) return false;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return false;

  const time = Date.parse(value);
  return !Number.isNaN(time) &&
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value);
}

export function isFuture(value) {
  const time = Date.parse(value);
  return !Number.isNaN(time) && time > Date.now();
}

export function randomSample(items, count) {
  if (count >= items.length) return [...items];

  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy.slice(0, count);
}

export async function mapWithConcurrency(items, concurrency, fn) {
  if (!items.length) return [];

  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      worker
    )
  );

  return results;
}

export function suffixNearDuplicatePairs(urls) {
  const parsed = urls.map((raw) => {
    try {
      const u = new URL(raw);
      const clean = u.pathname.replace(/\/+$/, "");
      return { raw, clean };
    } catch {
      return undefined;
    }
  }).filter(Boolean);

  const byParent = new Map();

  for (const item of parsed) {
    const parts = item.clean.split("/").filter(Boolean);
    if (!parts.length) continue;

    const parent = "/" + parts.slice(0, -1).join("/");
    const list = byParent.get(parent) ?? [];
    list.push(item);
    byParent.set(parent, list);
  }

  const pairs = [];

  for (const list of byParent.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].clean.split("/").pop();
        const b = list[j].clean.split("/").pop();

        if (a + "-2" === b || b + "-2" === a) {
          pairs.push([list[i].raw, list[j].raw]);
        }
      }
    }
  }

  return pairs;
}

export function toScopeFromResolved(baseUrl, resolvedSitemapUrl) {
  const base = new URL(baseUrl);
  const sitemap = new URL(resolvedSitemapUrl);

  // If the original site redirects to a canonical host, validate against
  // the canonical host. Keep the original subdirectory prefix when supplied.
  return {
    protocol: "https:",
    hostname: sitemap.hostname,
    pathPrefix: base.pathname === "/" ? "/" : base.pathname
  };
}
