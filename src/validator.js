import { request } from "playwright";
import { discoverSitemap } from "./discovery.js";
import { parseSitemap } from "./parser.js";
import {
  allChecks,
  makeStatusResult
} from "./checks.js";
import {
  mapWithConcurrency,
  randomSample,
  toScopeFromResolved
} from "./utils.js";

export async function validateSite(baseUrl, config) {
  const report = {
    baseUrl,
    expectedScope: {
      protocol: "https:",
      hostname: new URL(baseUrl).hostname,
      pathPrefix: new URL(baseUrl).pathname
    },

    discovery: {
      sitemapUrl: undefined,
      sitemapType: undefined,
      method: undefined,
      attempts: [],
      redirects: []
    },

    extraction: {
      urlCount: 0,
      metadataCounts: {
        lastmod: 0,
        changefreq: 0,
        priority: 0
      },
      childSitemapsDiscovered: 0,
      childSitemapsTraversed: 0,
      depthLimitHits: [],
      files: []
    },

    checks: [],

    urlInventory: [],

    summary: {
      passed: false,
      failedChecks: 0,
      warnings: 0,
      totalUrls: 0,
      statusChecked: 0,
      statusFailures: 0
    },

    errors: []
  };

  let requestContext;

  try {
    requestContext = await request.newContext({
      baseURL: baseUrl,
      timeout: config.execution.requestTimeoutMs,
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: {
        "User-Agent": config.execution.userAgent,
        "Accept": "application/xml,text/xml,text/html;q=0.9,*/*;q=0.8"
      }
    });

    const discovered = await discoverSitemap(
      requestContext,
      baseUrl
    );

    report.discovery.sitemapUrl =
      discovered.finalUrl;

    report.discovery.method =
      discovered.method;

    report.discovery.attempts =
      discovered.attempts;

    report.discovery.redirects =
      discovered.redirects;

    // The resolved sitemap host becomes the canonical host scope.
    report.expectedScope =
      toScopeFromResolved(
        baseUrl,
        discovered.finalUrl
      );

    const entries = [];
    const visited = new Set();

    let rootType;
    let rootWellFormed = true;
    let rootNamespaceValid = true;

    const structuralErrors = [];
    const structuralEvidence = [];

    const queue = [{
      url: discovered.finalUrl,
      body: discovered.body,
      contentType: discovered.contentType,
      status: discovered.status,
      depth: 0
    }];

    while (queue.length) {
      const current = queue.shift();

      if (visited.has(current.url)) {
        continue;
      }

      visited.add(current.url);

      let parsed;

      try {
        parsed = parseSitemap(
          current.url,
          current.body,
          current.contentType
        );
      } catch (error) {
        structuralErrors.push(
          `${current.url}: ${error.message}`
        );

        report.extraction.files.push({
          url: current.url,
          type: "unknown",
          status: current.status,
          bytes: current.body.byteLength,
          extractedUrls: 0
        });

        continue;
      }

      rootType ??= parsed.type;

      rootWellFormed =
        rootWellFormed &&
        parsed.wellFormed;

      rootNamespaceValid =
        rootNamespaceValid &&
        parsed.namespaceValid;

      structuralErrors.push(
        ...parsed.errors.map(
          (error) =>
            `${current.url}: ${error}`
        )
      );
      structuralEvidence.push(
        ...(parsed.evidence ?? [])
      );

      report.extraction.files.push({
        url: current.url,
        type: parsed.type,
        status: current.status,
        bytes: current.body.byteLength,
        extractedUrls: parsed.entries.length
      });

      entries.push(
        ...parsed.entries
      );

      if (parsed.type !== "xml-index") {
        continue;
      }

      report.extraction.childSitemapsDiscovered +=
        parsed.childSitemaps.length;

      const children =
        parsed.childSitemaps.slice(
          0,
          config.sitemap.maxChildSitemaps
        );

      if (
        parsed.childSitemaps.length >
        config.sitemap.maxChildSitemaps
      ) {
        structuralErrors.push(
          `${current.url}: index contains ${parsed.childSitemaps.length} child sitemaps; only ${config.sitemap.maxChildSitemaps} were traversed.`
        );
      }

      if (
        current.depth >=
        config.sitemap.maxIndexDepth
      ) {
        report.extraction.depthLimitHits.push(
          current.url
        );
        continue;
      }

      const childResults =
        await mapWithConcurrency(
          children,
          config.execution.sitemapConcurrency,
          async (childUrl) => {
            try {
              const response =
                await requestContext.get(
                  childUrl,
                  {
                    failOnStatusCode: false
                  }
                );

              if (!response.ok()) {
                structuralErrors.push(
                  `${childUrl}: HTTP ${response.status()} while fetching child sitemap.`
                );
                return undefined;
              }

              return {
                url: response.url(),
                body: await response.body(),
                contentType:
                  (
                    response.headers()[
                      "content-type"
                    ] ?? ""
                  )
                    .split(";")[0]
                    .trim()
                    .toLowerCase(),
                status: response.status(),
                depth: current.depth + 1
              };
            } catch (error) {
              structuralErrors.push(
                `Failed to fetch child sitemap ${childUrl}: ${error.message}`
              );
              return undefined;
            }
          }
        );

      for (const child of childResults) {
        if (!child) continue;

        report.extraction.childSitemapsTraversed++;

        queue.push(child);
      }
    }

    report.discovery.sitemapType =
      rootType;

    report.extraction.urlCount =
      entries.length;

    report.extraction.metadataCounts = {
      lastmod: entries.filter(
        (entry) =>
          entry.lastmod !== undefined
      ).length,

      changefreq: entries.filter(
        (entry) =>
          entry.changefreq !== undefined
      ).length,

      priority: entries.filter(
        (entry) =>
          entry.priority !== undefined
      ).length
    };

    report.checks = allChecks(
      config,
      {
        wellFormed: rootWellFormed,
        namespaceValid:
          rootNamespaceValid,
        errors: structuralErrors
      },
      entries,
      report.extraction.files,
      report.expectedScope,
      structuralEvidence
    );

    const urls =
      entries.map(
        (entry) => entry.loc
      );

    const statusMap = new Map();

    if (
      config.checks.status &&
      config.status.mode !== "none" &&
      urls.length
    ) {
      const selected =
        config.status.mode === "full"
          ? urls
          : randomSample(
              urls,
              config.status.sampleSize
            );

      const results =
        await mapWithConcurrency(
          selected,
          config.status.concurrency,
          async (url) => {
            try {
              const head =
                await requestContext.fetch(
                  url,
                  {
                    method: "HEAD",
                    timeout:
                      config.status.timeoutMs,
                    failOnStatusCode:
                      false
                  }
                );

              if (
                head.status() === 200
              ) {
                return {
                  url,
                  status: "PASS",
                  httpStatus: 200,
                  error: ""
                };
              }

              const get =
                await requestContext.get(
                  url,
                  {
                    timeout:
                      config.status.timeoutMs,
                    failOnStatusCode:
                      false
                  }
                );

              return {
                url,
                status:
                  get.status() === 200
                    ? "PASS"
                    : "FAIL",
                httpStatus:
                  get.status(),
                error:
                  get.status() === 200
                    ? ""
                    : `HTTP ${get.status()}`
              };
            } catch (error) {
              return {
                url,
                status: "FAIL",
                httpStatus: "",
                error: error.message
              };
            }
          }
        );

      for (const item of results) {
        statusMap.set(
          item.url,
          item
        );
      }

      const failures =
        results.filter(
          (item) =>
            item.status === "FAIL"
        );

      report.checks.push(
        makeStatusResult(
          true,
          config.status.mode,
          results.length,
          failures
        )
      );

      report.summary.statusChecked =
        results.length;

      report.summary.statusFailures =
        failures.length;
    } else {
      report.checks.push(
        makeStatusResult(
          false,
          "none",
          0,
          []
        )
      );
    }

    report.urlInventory =
      entries.map(
        (entry, index) => {
          const status =
            statusMap.get(
              entry.loc
            );

          return {
            row: index + 1,
            url: entry.loc,
            sourceSitemap:
              entry.sourceSitemap,
            sitemapType:
              report.extraction.files.find(
                (file) =>
                  file.url ===
                  entry.sourceSitemap
              )?.type ?? "unknown",
            lastmod:
              entry.lastmod ?? "",
            changefreq:
              entry.changefreq ?? "",
            priority:
              entry.priority ?? "",
            urlStatus:
              status?.status ??
              "NOT_CHECKED",
            httpStatus:
              status?.httpStatus ??
              "",
            statusError:
              status?.error ??
              ""
          };
        }
      );

    const order = [
      "wellFormedness",
      "urlCount",
      "urlFormat",
      "exactDuplicates",
      "suffixNearDuplicates",
      "hostConsistency",
      "status",
      "trailingSlashConsistency",
      "lastmodValidity"
    ];

    report.checks.sort(
      (a, b) =>
        order.indexOf(a.name) -
        order.indexOf(b.name)
    );

    report.summary.totalUrls =
      entries.length;

    report.summary.failedChecks =
      report.checks.filter(
        (check) =>
          check.enabled &&
          !check.passed
      ).length;

    report.summary.warnings =
      report.checks
        .filter(
          (check) =>
            check.name ===
            "suffixNearDuplicates"
        )
        .reduce(
          (count, check) =>
            count +
            (check.flaggedUrls.length
              ? 1
              : 0),
          0
        );

    report.summary.passed =
      report.summary.failedChecks === 0;
  } catch (error) {
    report.errors.push(
      error.message
    );

    report.summary.passed = false;
  } finally {
    await requestContext?.dispose();
  }

  return report;
}
