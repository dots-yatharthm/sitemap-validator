import fs from "node:fs";
import path from "node:path";
import { parseCli, printHelp } from "./config.js";
import { validateSite } from "./validator.js";
import { mapWithConcurrency } from "./utils.js";
import { writeHtml, writeXlsx } from "./report.js";

function createTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("-");
}

function siteSlug(baseUrl) {
  const url = new URL(baseUrl);
  const host = url.hostname;
  const pathPart = url.pathname
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return pathPart
    ? `${host}_${pathPart}`
    : host;
}

function singleSiteReport(report, site) {
  return {
    generatedAt: report.generatedAt,
    config: report.config,
    sites: [site],
    summary: {
      totalSites: 1,
      passedSites: site.summary.passed ? 1 : 0,
      failedSites: site.summary.passed ? 0 : 1
    }
  };
}

function buildOutputFileNames(outputDir, site, timestamp) {
  const slug = siteSlug(site.baseUrl);
  const status = site.summary.passed ? "PASS" : "FAIL";
  const prefix = `${slug}_sitemap-validation_${timestamp}`;
  return {
    html: path.join(
      outputDir,
      `${prefix}_${status}.html`
    ),
    json: path.join(
      outputDir,
      `${prefix}_${status}.json`
    )
  };
}

function printSummary(report, outputsBySite) {
  console.log("\n=== Sitemap Validation Summary ===");

  for (const site of report.sites) {
    const marker =
      site.summary.passed
        ? "PASS"
        : "FAIL";

    console.log(
      `[${marker}] ${site.baseUrl} | ` +
      `sitemap=${site.discovery.sitemapUrl ?? "not found"} | ` +
      `type=${site.discovery.sitemapType ?? "unknown"} | ` +
      `URLs Found=${site.summary.totalUrls} | ` +
      `status=${site.summary.statusChecked} checked / ${site.summary.statusFailures} failed | ` +
      `failedChecks=${site.summary.failedChecks}`
    );

    for (const check of site.checks) {
      if (check.status === "skip") continue;

      const checkMarker =
        check.passed
          ? "PASS"
          : "FAIL";

      console.log(
        `  ${checkMarker} ${check.name}: ${check.message}`
      );
    }

    if (site.extraction.childSitemapsDiscovered) {
      console.log(
        `  Sitemaps: ${site.extraction.childSitemapsTraversed}/${site.extraction.childSitemapsDiscovered} child sitemaps traversed`
      );
    }

    if (site.extraction.depthLimitHits.length) {
      console.log(
        `  WARNING: sitemap index depth limit reached for ${site.extraction.depthLimitHits.length} sitemap(s)`
      );
    }

    for (const error of site.errors) {
      console.log(`  ERROR: ${error}`);
    }

    const outputs = outputsBySite.get(site.baseUrl);
    console.log("  Deliverables:");
    console.log(`    HTML: ${outputs.html}`);
    console.log(`    XLSX: ${outputs.xlsx}`);
    console.log(`    JSON: ${outputs.json}`);
  }

  console.log(
    `\nSites: ${report.summary.passedSites}/${report.summary.totalSites} passed | ` +
    `URLs: ${report.sites.reduce((sum, site) => sum + site.summary.totalUrls, 0)}`
  );
}

async function main() {
  const {
    config,
    showHelp
  } = parseCli(
    process.argv.slice(2)
  );

  if (showHelp) {
    printHelp();
    return;
  }

  const started = Date.now();

  const sites =
    await mapWithConcurrency(
      config.sites,
      config.execution.siteConcurrency,
      async (site) => {
        console.log(`\nValidating ${site} ...`);

        return validateSite(
          site,
          config
        );
      }
    );

  const report = {
    generatedAt: new Date().toISOString(),
    config,
    sites,
    summary: {
      totalSites: sites.length,
      passedSites: sites.filter(
        (site) => site.summary.passed
      ).length,
      failedSites: sites.filter(
        (site) => !site.summary.passed
      ).length
    }
  };

  const outputDir = path.resolve(
    config.output.directory
  );

  fs.mkdirSync(outputDir, { recursive: true });

  // One timestamp is shared by all artifacts generated during this execution.
  // This makes the HTML/XLSX/JSON files from the same run easy to identify.
  const timestamp = createTimestamp();
  const outputsBySite = new Map();

  for (const site of sites) {
    const outputs = buildOutputFileNames(
      outputDir,
      site,
      timestamp
    );

    const siteReport = singleSiteReport(
      report,
      site
    );

    fs.writeFileSync(
      outputs.json,
      JSON.stringify(
        siteReport,
        null,
        2
      ),
      "utf8"
    );

    writeHtml(
      siteReport,
      outputs.html
    );

    const siteSlugValue = siteSlug(site.baseUrl);
    const siteStatus = site.summary.passed ? "PASS" : "FAIL";
    outputs.xlsx = path.join(
      outputDir,
      `${siteSlugValue}_sitemap-url-inventory_${timestamp}_${siteStatus}.xlsx`
    );

    await writeXlsx(
      siteReport,
      outputs.xlsx
    );

    outputsBySite.set(
      site.baseUrl,
      outputs
    );
  }

  printSummary(
    report,
    outputsBySite
  );

  console.log(
    `  Elapsed: ${(
      (Date.now() - started) /
      1000
    ).toFixed(1)}s`
  );

  if (report.summary.failedSites > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : error
  );

  process.exitCode = 2;
});
