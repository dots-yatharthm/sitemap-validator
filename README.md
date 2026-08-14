# Playwright Sitemap Validator

A JavaScript/Node.js automation tool for validating website XML sitemaps and generating QA-friendly validation reports.

## What it does

The validator:

- Accepts one or more website URLs.
- Discovers the sitemap through `sitemap.xml` and `robots.txt`.
- Follows sitemap redirects and records the resolved sitemap URL.
- Supports:
  - XML URL sitemaps (`<urlset>`)
  - XML sitemap indexes (`<sitemapindex>`)
  - HTML sitemaps
  - Gzip-compressed XML sitemaps
- Traverses child sitemaps from sitemap indexes.
- Extracts sitemap URLs and available metadata such as `lastmod`, `changefreq`, and `priority`.
- Supports configurable sitemap-index recursion depth and child-sitemap limits.
- Performs the following validation checks:
  1. Well-formedness
  2. URL count and sitemap file limits
  3. URL format
  4. Exact duplicates
  5. Suffix near-duplicates
  6. Host/path consistency
  7. HTTP status
  8. Trailing-slash consistency
  9. `lastmod` validity

## Reports

Each validation run generates:

- **HTML report** — client/QA-friendly validation report with pass/fail results and failure evidence.
- **XLSX workbook** — complete URL inventory and detailed evidence for applicable failed checks.
- **JSON report** — machine-readable validation results.

Reports are generated with unique site/date/time-based filenames.

Generated reports are stored in the `reports/` directory, which is excluded from Git through `.gitignore`.

## Requirements

- Node.js
- npm
- Playwright Chromium

## Installation

```bash
npm install
npx playwright install chromium
```

## Run a sitemap validation

For a single site:

```bash
npm start -- --url https://example.com
```

For multiple sites:

```bash
npm start -- --url https://example.com --url https://example.org
```

## Run tests

```bash
npm test
```

## Project structure

```text
playwright-sitemap-validator/
├── src/
├── tests/
├── reports/                 # Generated reports; ignored by Git
├── config.example.json
├── package.json
├── package-lock.json
├── README.md
└── .gitignore
```

## Notes

- The project is implemented in JavaScript using Node.js.
- Playwright `APIRequestContext` is used for sitemap/network requests rather than a full browser page unless browser rendering is required.
- Validation options can be configured through the available CLI/configuration options.
- Do not commit generated client reports or sensitive configuration files to Git.
