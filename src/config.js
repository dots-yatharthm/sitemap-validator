import fs from "node:fs";
import path from "node:path";
import { normalizeBaseUrl } from "./utils.js";

const DEFAULTS = {
  sites: [],
  sitemap: {
    maxIndexDepth: 1,
    maxChildSitemaps: 50,
    maxFileBytes: 50 * 1024 * 1024
  },
  status: {
    mode: "sample",
    sampleSize: 100,
    concurrency: 10,
    timeoutMs: 15000
  },
  execution: {
    siteConcurrency: 3,
    sitemapConcurrency: 10,
    requestTimeoutMs: 30000,
    userAgent: "Playwright-Sitemap-Validator/3.0"
  },
  checks: {
    wellFormedness: true,
    urlCount: true,
    urlFormat: true,
    exactDuplicates: true,
    suffixNearDuplicates: true,
    hostConsistency: true,
    status: true,
    trailingSlashConsistency: true,
    lastmodValidity: true
  },
  output: {
    directory: "reports"
  }
};

function deepMerge(base, override) {
  const out = structuredClone(base);

  function merge(target, source) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        target[key] ??= {};
        merge(target[key], value);
      } else if (value !== undefined) {
        target[key] = value;
      }
    }
  }

  merge(out, override);
  return out;
}

export function parseCli(argv) {
  let config = structuredClone(DEFAULTS);
  let configPath;
  const urls = [];
  const skips = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      return { config, showHelp: true };
    }

    if (arg === "--config") {
      configPath = argv[++i];
    } else if (arg === "--url") {
      urls.push(argv[++i]);
    } else if (arg === "--status") {
      const value = argv[++i];

      if (value === "none" || value === "sample" || value === "full") {
        config.status.mode = value;
      } else if (value?.startsWith("sample:")) {
        config.status.mode = "sample";
        config.status.sampleSize = Number(value.split(":")[1]);
      } else {
        throw new Error(`Invalid --status value: ${value}`);
      }
    } else if (arg === "--index-depth") {
      config.sitemap.maxIndexDepth = Number(argv[++i]);
    } else if (arg === "--max-child-sitemaps") {
      config.sitemap.maxChildSitemaps = Number(argv[++i]);
    } else if (arg === "--site-concurrency") {
      config.execution.siteConcurrency = Number(argv[++i]);
    } else if (arg === "--sitemap-concurrency") {
      config.execution.sitemapConcurrency = Number(argv[++i]);
    } else if (arg === "--status-concurrency") {
      config.status.concurrency = Number(argv[++i]);
    } else if (arg === "--output") {
      config.output.directory = argv[++i];
    } else if (arg === "--skip") {
      skips.push(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (configPath) {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(configPath), "utf8")
    );
    config = deepMerge(config, raw);
  }

  if (urls.length) config.sites = urls;

  if (!config.sites.length) {
    throw new Error("Provide at least one --url or a config file containing sites.");
  }

  for (const check of skips) {
    if (!(check in config.checks)) {
      throw new Error(`Unknown check: ${check}`);
    }
    config.checks[check] = false;
  }

  config.sites = config.sites.map(normalizeBaseUrl);
  config.sitemap.maxIndexDepth = Math.max(0, Number(config.sitemap.maxIndexDepth));
  config.sitemap.maxChildSitemaps = Math.max(1, Number(config.sitemap.maxChildSitemaps));
  config.status.sampleSize = Math.max(1, Number(config.status.sampleSize));
  config.status.concurrency = Math.max(1, Number(config.status.concurrency));
  config.execution.siteConcurrency = Math.max(1, Number(config.execution.siteConcurrency));
  config.execution.sitemapConcurrency = Math.max(1, Number(config.execution.sitemapConcurrency));

  return { config, showHelp: false };
}

export function printHelp() {
  console.log(`
Playwright Sitemap Validator v3

Usage:
  npm start -- --url https://example.com
  npm start -- --config config.json

Options:
  --url URL                  Add a site. Repeatable.
  --config FILE              Load JSON configuration.
  --status none|sample|full  Status mode. sample:N is supported.
  --index-depth N            Sitemap-index recursion depth. Default 1.
  --max-child-sitemaps N     Max children per index. Default 50.
  --site-concurrency N       Concurrent site runs. Default 3.
  --sitemap-concurrency N    Concurrent child-sitemap fetches. Default 10.
  --status-concurrency N     Concurrent URL status requests. Default 10.
  --output DIR               Deliverable directory. Default reports.
  --skip CHECK               Disable one core check. Repeatable.
  --help                     Show help.
`);
}
