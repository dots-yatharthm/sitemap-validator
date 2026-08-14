import { contentTypeOf, isHtmlContent, isXmlContent } from "./utils.js";

async function fetchCandidate(request, url, attempts, redirects) {
  try {
    const response = await request.get(url, {
      failOnStatusCode: false
    });

    const finalUrl = response.url();
    const contentType = contentTypeOf(response.headers());
    const body = await response.body();
    const status = response.status();

    if (finalUrl !== url) {
      redirects.push({
        from: url,
        to: finalUrl,
        status
      });
    }

    const usable =
      response.ok() &&
      (isXmlContent(contentType, finalUrl) ||
       isHtmlContent(contentType));

    attempts.push({
      url,
      status,
      finalUrl,
      contentType,
      result: usable ? "usable" : "not-usable"
    });

    if (usable) {
      return {
        requestedUrl: url,
        finalUrl,
        contentType,
        body,
        status
      };
    }
  } catch (error) {
    attempts.push({
      url,
      error: String(error),
      result: "error"
    });
  }

  return undefined;
}

export async function discoverSitemap(request, baseUrl) {
  const attempts = [];
  const redirects = [];

  const directUrl = new URL("sitemap.xml", baseUrl).toString();

  const direct = await fetchCandidate(
    request,
    directUrl,
    attempts,
    redirects
  );

  if (direct) {
    return {
      ...direct,
      method: "direct",
      attempts,
      redirects
    };
  }

  const robotsUrl = new URL("robots.txt", baseUrl).toString();

  try {
    const response = await request.get(robotsUrl, {
      failOnStatusCode: false
    });

    const text = await response.text();

    attempts.push({
      url: robotsUrl,
      status: response.status(),
      finalUrl: response.url(),
      contentType: contentTypeOf(response.headers()),
      result: response.ok() ? "usable" : "not-usable"
    });

    const sitemapUrls = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^sitemap\s*:/i.test(line))
      .map((line) => line.replace(/^sitemap\s*:/i, "").trim())
      .filter(Boolean);

    for (const candidate of sitemapUrls) {
      let resolved;

      try {
        resolved = new URL(candidate, response.url()).toString();
      } catch {
        attempts.push({
          url: candidate,
          error: "Invalid Sitemap directive URL.",
          result: "error"
        });
        continue;
      }

      const found = await fetchCandidate(
        request,
        resolved,
        attempts,
        redirects
      );

      if (found) {
        return {
          ...found,
          method: "robots.txt",
          attempts,
          redirects
        };
      }
    }
  } catch (error) {
    attempts.push({
      url: robotsUrl,
      error: String(error),
      result: "error"
    });
  }

  throw new Error(
    "No usable sitemap found via /sitemap.xml or robots.txt Sitemap directives."
  );
}
