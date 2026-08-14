import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function checkLabel(name) {
  return {
    wellFormedness: "Well-formedness",
    urlCount: "URL Count & File Limits",
    urlFormat: "URL Format",
    exactDuplicates: "Exact Duplicates",
    suffixNearDuplicates: "Suffix Near-Duplicates",
    hostConsistency: "Host Consistency",
    status: "HTTP Status",
    trailingSlashConsistency: "Trailing Slash Consistency",
    lastmodValidity: "lastmod Validity"
  }[name] ?? name;
}

function statusBadge(check) {
  const label =
    check.status === "skip"
      ? "SKIPPED"
      : check.passed
        ? "PASS"
        : "FAIL";

  const cls =
    check.status === "skip"
      ? "skip"
      : check.passed
        ? "pass"
        : "fail";

  return `<span class="badge ${cls}">${label}</span>`;
}


function detailRowsForCheck(site, check) {
  const urls = check.flaggedUrls ?? [];
  const details = check.details;
  const rows = [];

  if (check.name === "wellFormedness") {
    for (const ev of details?.evidence ?? []) {
      rows.push(`<div class="evidence-card"><div><strong>${escapeHtml(ev.url)}</strong></div><div>Root detected: <code>${escapeHtml(ev.rootName || "unknown")}</code></div><div>Namespace: <code>${escapeHtml(ev.namespace || "missing")}</code></div><div>Focus line: ${escapeHtml(ev.focusLine)}</div>${ev.validationError ? `<div>Parser error: <code>${escapeHtml(ev.validationError)}</code></div>` : ""}<pre>${escapeHtml((ev.snippet ?? []).map((line) => `${String(line.line).padStart(4, " ")} | ${line.text}`).join("\n"))}</pre></div>`);
    }
    if (!rows.length && (details?.errors ?? []).length) {
      rows.push(`<div class="evidence-card"><pre>${escapeHtml(details.errors.join("\n"))}</pre></div>`);
    }
  }

  if (check.name === "urlCount") {
    const files = details?.oversizedFiles ?? [];
    const over = details?.overUrlLimitFiles ?? [];
    const affected = [...files, ...over];
    if (affected.length) {
      rows.push(`<div class="notice warning">URL Count & File Limits failures are file-level protocol violations. The affected sitemap files are listed below; the complete URL inventory is available in the XLSX workbook.</div>`);
      rows.push(`<div class="table-wrap"><table><thead><tr><th>Sitemap</th><th>URLs</th><th>Bytes</th><th>Over URL Limit</th><th>Over 50 MB</th></tr></thead><tbody>${affected.map((f) => `<tr><td class="url">${escapeHtml(f.url)}</td><td>${formatNumber(f.extractedUrls)}</td><td>${formatNumber(f.bytes)}</td><td>${f.extractedUrls > 50000 ? "YES" : "NO"}</td><td>${f.bytes > 50*1024*1024 ? "YES" : "NO"}</td></tr>`).join("")}</tbody></table></div>`);
    if (urls.length) {
      rows.push(`<details class="nested-details"><summary>URLs contained in affected sitemap files (${formatNumber(urls.length)})</summary><div class="flagged-list"><ol>${urls.map((url) => `<li class="url">${escapeHtml(url)}</li>`).join("")}</ol></div></details>`);
    }
    }
  }

  if (check.name === "suffixNearDuplicates") {
    const pairs = details ?? [];
    if (pairs.length) rows.push(`<div class="table-wrap"><table><thead><tr><th>#</th><th>URL A</th><th>URL B</th></tr></thead><tbody>${pairs.map((pair,i) => `<tr><td>${i+1}</td><td class="url">${escapeHtml(pair[0])}</td><td class="url">${escapeHtml(pair[1])}</td></tr>`).join("")}</tbody></table></div>`);
  }

  if (urls.length && check.name !== "suffixNearDuplicates" && check.name !== "wellFormedness" && check.name !== "urlCount" && check.name !== "trailingSlashConsistency") {
    rows.push(`<div class="flagged-list"><div class="list-header">Flagged URLs (${formatNumber(urls.length)})</div><ol>${urls.map((url) => `<li class="url">${escapeHtml(url)}</li>`).join("")}</ol></div>`);
  }

  if (check.name === "trailingSlashConsistency") {
    const withoutUrls = details?.withoutTrailingSlashUrls ?? [];
    rows.push(`<div class="flagged-list"><div class="list-header">Without trailing slash (${formatNumber(withoutUrls.length)})</div><ol>${withoutUrls.map((u)=>`<li class="url">${escapeHtml(u)}</li>`).join("")}</ol></div>`);
  }

  return rows.join("");
}

function renderCheckDetails(site) {
  const relevant = site.checks.filter((check) => {
    if (check.name === "suffixNearDuplicates") return check.flaggedUrls?.length;
    return check.status === "fail" || check.flaggedUrls?.length || (check.name === "wellFormedness" && check.details?.evidence?.length);
  });

  if (!relevant.length) return "";

  const failed = relevant.filter((check) => check.status === "fail").length;
  const reviewOnly = relevant.filter((check) => check.status !== "fail").length;

  const items = relevant.map((check) => `
    <details class="check-details ${check.passed ? "warning-detail" : "fail-detail"}">
      <summary>
        <span class="summary-left">
          <span class="detail-icon">${check.passed ? "!" : "×"}</span>
          <strong>${escapeHtml(checkLabel(check.name))}</strong>
          <span class="detail-kind">${check.passed ? "Manual Review" : "Failure Evidence"}</span>
        </span>
        <span class="summary-count">${check.flaggedUrls?.length ? `${formatNumber(check.flaggedUrls.length)} affected` : "View details"}</span>
      </summary>
      <p>${escapeHtml(check.message)}</p>
      ${detailRowsForCheck(site, check) || '<div class="muted">No additional evidence was captured.</div>'}
    </details>
  `).join("");

  return `
    <div class="failure-evidence-panel">
      <div class="failure-evidence-header">
        <div>
          <div class="eyebrow danger-eyebrow">ACTION REQUIRED</div>
          <h3>Failure & Review Details</h3>
          <p>Expand a check below to see the exact affected URLs and supporting evidence.</p>
        </div>
        <div class="failure-evidence-stats">
          <span class="failure-stat"><strong>${formatNumber(failed)}</strong> failed</span>
          ${reviewOnly ? `<span class="review-stat"><strong>${formatNumber(reviewOnly)}</strong> review</span>` : ""}
        </div>
      </div>
      <div class="failure-evidence-list">${items}</div>
    </div>
  `;
}

export async function writeXlsx(report, outputFile) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Playwright Sitemap Validator";
  workbook.created = new Date(report.generatedAt);
  workbook.properties.date1904 = false;

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Site", key: "site", width: 36 },
    { header: "Result", key: "result", width: 12 },
    { header: "Sitemap", key: "sitemap", width: 50 },
    { header: "Type", key: "type", width: 18 },
    { header: "URLs", key: "urls", width: 12 },
    { header: "Failed Checks", key: "failed", width: 15 },
    { header: "Status Checked", key: "checked", width: 16 },
    { header: "Status Failures", key: "statusFailures", width: 16 }
  ];
  report.sites.forEach(site => summary.addRow({
    site: site.baseUrl,
    result: site.summary.passed ? "PASS" : "FAIL",
    sitemap: site.discovery.sitemapUrl ?? "",
    type: site.discovery.sitemapType ?? "",
    urls: site.summary.totalUrls,
    failed: site.summary.failedChecks,
    checked: site.summary.statusChecked,
    statusFailures: site.summary.statusFailures
  }));
  summary.views = [{ state: "frozen", ySplit: 1 }];
  summary.autoFilter = "A1:H1";
  summary.getRow(1).font = { bold: true };

  for (const site of report.sites) {
    const slug = site.baseUrl.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "site";
    const inv = workbook.addWorksheet(`${slug}_URLs`.slice(0,31));
    inv.columns = [
      { header:"#", key:"row", width:8 }, { header:"URL", key:"url", width:70 },
      { header:"Source Sitemap", key:"source", width:50 }, { header:"Type", key:"type", width:18 },
      { header:"lastmod", key:"lastmod", width:22 }, { header:"changefreq", key:"changefreq", width:14 },
      { header:"priority", key:"priority", width:12 }, { header:"URL Status", key:"status", width:14 },
      { header:"HTTP Status", key:"http", width:14 }, { header:"Status Error", key:"error", width:40 }
    ];
    site.urlInventory.forEach(r => inv.addRow({ row:r.row, url:r.url, source:r.sourceSitemap, type:r.sitemapType, lastmod:r.lastmod, changefreq:r.changefreq, priority:r.priority, status:r.urlStatus, http:r.httpStatus, error:r.statusError }));
    inv.getRow(1).font = { bold:true }; inv.views = [{ state: "frozen", ySplit: 1 }]; inv.autoFilter = `A1:J${Math.max(1, inv.rowCount)}`;

    for (const check of site.checks) {
      const flagged = check.flaggedUrls ?? [];
      const hasDetail = check.name === "wellFormedness" ? (check.details?.evidence?.length || check.details?.errors?.length) : check.name === "urlCount" ? ((check.details?.affectedSitemapFiles?.length ?? 0) > 0) : check.name === "suffixNearDuplicates" ? ((check.details?.length ?? 0) > 0) : flagged.length > 0 || (check.name === "trailingSlashConsistency" && (check.details?.withoutTrailingSlashUrls?.length || check.details?.withTrailingSlashUrls?.length));
      if (!hasDetail) continue;

      let wsName = check.name.replace(/[^A-Za-z0-9]/g,"_").slice(0, 25);
      let suffix = 1; const base = wsName;
      while (workbook.getWorksheet(wsName)) wsName = `${base.slice(0, 25-suffix.toString().length)}_${suffix++}`;
      const ws = workbook.addWorksheet(wsName);

      if (check.name === "wellFormedness") {
        ws.columns = [{header:"Sitemap",key:"sitemap",width:55},{header:"Root",key:"root",width:20},{header:"Namespace",key:"namespace",width:55},{header:"Focus Line",key:"line",width:12},{header:"Parser Error",key:"error",width:70},{header:"Source Evidence",key:"evidence",width:100}];
        for (const ev of check.details?.evidence ?? []) ws.addRow({sitemap:ev.url,root:ev.rootName,namespace:ev.namespace,line:ev.focusLine,error:ev.validationError,evidence:(ev.snippet??[]).map(x=>`${x.line} | ${x.text}`).join("\n")});
      } else if (check.name === "suffixNearDuplicates") {
        ws.columns = [{header:"Pair #",key:"pair",width:10},{header:"URL A",key:"a",width:80},{header:"URL B",key:"b",width:80}];
        (check.details ?? []).forEach((pair,i)=>ws.addRow({pair:i+1,a:pair[0],b:pair[1]}));
      } else if (check.name === "urlCount") {
        ws.columns = [{header:"Sitemap",key:"sitemap",width:65},{header:"URLs in File",key:"urls",width:15},{header:"Bytes",key:"bytes",width:15},{header:"Over 50,000 URLs",key:"urlLimit",width:20},{header:"Over 50 MB",key:"sizeLimit",width:15}];
        const affected=[...(check.details?.oversizedFiles??[]),...(check.details?.overUrlLimitFiles??[])];
        affected.forEach(f=>ws.addRow({sitemap:f.url,urls:f.extractedUrls,bytes:f.bytes,urlLimit:f.extractedUrls>50000?"YES":"NO",sizeLimit:f.bytes>50*1024*1024?"YES":"NO"}));
      } else if (check.name === "trailingSlashConsistency") {
        ws.columns = [{header:"With Trailing Slash",key:"with",width:80},{header:"Without Trailing Slash",key:"without",width:80}];
        const a=check.details?.withTrailingSlashUrls??[], b=check.details?.withoutTrailingSlashUrls??[]; const n=Math.max(a.length,b.length);
        for(let i=0;i<n;i++) ws.addRow({with:a[i]??"",without:b[i]??""});
      } else {
        ws.columns = [{header:"Flagged URL",key:"url",width:100}];
        flagged.forEach(url=>ws.addRow({url}));
      }
      ws.getRow(1).font={bold:true}; ws.views = [{ state: "frozen", ySplit: 1 }]; if(ws.rowCount>1) ws.autoFilter=`A1:${String.fromCharCode(64+Math.min(ws.columnCount,26))}${ws.rowCount}`;
    }
  }

  await workbook.xlsx.writeFile(outputFile);
}


export function writeHtml(report, outputFile) {
  const totalUrls =
    report.sites.reduce(
      (sum, site) =>
        sum + site.summary.totalUrls,
      0
    );

  const passedSites =
    report.summary.passedSites;

  const failedSites =
    report.summary.failedSites;

  const failedChecks =
    report.sites.reduce(
      (sum, site) =>
        sum + site.summary.failedChecks,
      0
    );

  const statusChecked =
    report.sites.reduce(
      (sum, site) =>
        sum + site.summary.statusChecked,
      0
    );

  const statusFailures =
    report.sites.reduce(
      (sum, site) =>
        sum + site.summary.statusFailures,
      0
    );

  const overallPass =
    failedSites === 0;

  const siteSections =
    report.sites.map((site) => {
      const checks = site.checks.map((check) => `
        <tr>
          <td><strong>${escapeHtml(checkLabel(check.name))}</strong></td>
          <td>${statusBadge(check)}</td>
          <td>${escapeHtml(check.message)}</td>
          <td class="mono">${escapeHtml(JSON.stringify(check.counts))}</td>
        </tr>
      `).join("");

      const sitemapFiles =
        site.extraction.files.map((file) => `
          <tr>
            <td>${escapeHtml(file.url)}</td>
            <td>${escapeHtml(file.type)}</td>
            <td>${formatNumber(file.extractedUrls)}</td>
            <td>${formatNumber(file.bytes)}</td>
            <td>${file.status ?? ""}</td>
          </tr>
        `).join("");

      const preview =
        site.urlInventory.slice(0, 250)
          .map((row) => `
            <tr>
              <td>${row.row}</td>
              <td class="url">${escapeHtml(row.url)}</td>
              <td>${escapeHtml(row.sourceSitemap)}</td>
              <td>${escapeHtml(row.lastmod)}</td>
              <td>${escapeHtml(row.urlStatus)}</td>
              <td>${escapeHtml(row.httpStatus)}</td>
            </tr>
          `).join("");

      return `
        <section class="site-section">
          <div class="section-title">
            <div>
              <div class="eyebrow">SITE VALIDATION</div>
              <h2>${escapeHtml(site.baseUrl)}</h2>
            </div>
            <div>${site.summary.passed
              ? '<span class="hero-pass">PASS</span>'
              : '<span class="hero-fail">FAIL</span>'}</div>
          </div>

          <div class="facts">
            <div><span>Resolved Sitemap</span><strong>${escapeHtml(site.discovery.sitemapUrl ?? "Not found")}</strong></div>
            <div><span>Sitemap Type</span><strong>${escapeHtml(site.discovery.sitemapType ?? "Unknown")}</strong></div>
            <div><span>URLs Discovered</span><strong>${formatNumber(site.summary.totalUrls)}</strong></div>
            <div><span>Sitemap Files</span><strong>${formatNumber(site.extraction.files.length)}</strong></div>
            <div><span>Child Sitemaps</span><strong>${formatNumber(site.extraction.childSitemapsTraversed)} / ${formatNumber(site.extraction.childSitemapsDiscovered)}</strong></div>
            <div><span>Expected Scope</span><strong>${escapeHtml(site.expectedScope.hostname + site.expectedScope.pathPrefix)}</strong></div>
          </div>

          <h3>Validation Checks</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Check</th><th>Result</th><th>Finding</th><th>Counts</th></tr>
              </thead>
              <tbody>${checks}</tbody>
            </table>
          </div>

          ${renderCheckDetails(site)}

          <h3>Sitemap Files</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Sitemap</th><th>Type</th><th>URLs</th><th>Bytes</th><th>HTTP</th></tr>
              </thead>
              <tbody>${sitemapFiles}</tbody>
            </table>
          </div>

          ${site.discovery.redirects.length ? `
            <h3>Redirect Chain</h3>
            <div class="redirects">
              ${site.discovery.redirects.map((r) =>
                `<div><span>${escapeHtml(r.from)}</span><b>→</b><span>${escapeHtml(r.to)}</span></div>`
              ).join("")}
            </div>
          ` : ""}

          <h3>URL Inventory Preview</h3>
          <p class="muted">
            Showing the first ${Math.min(250, site.urlInventory.length)} URLs.
            The XLSX deliverable contains the complete inventory of ${formatNumber(site.urlInventory.length)} URLs.
          </p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>URL</th><th>Source Sitemap</th><th>lastmod</th><th>Status</th><th>HTTP</th></tr>
              </thead>
              <tbody>${preview || '<tr><td colspan="6">No URLs were extracted.</td></tr>'}</tbody>
            </table>
          </div>

          ${site.extraction.depthLimitHits.length ? `
            <div class="notice warning">
              Sitemap recursion depth was reached for ${site.extraction.depthLimitHits.length} sitemap(s).
              Increase <code>maxIndexDepth</code> if deeper nested indexes are expected.
            </div>
          ` : ""}

          ${site.errors.length ? `
            <div class="notice danger">
              <strong>Execution errors</strong>
              <ul>${site.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
            </div>
          ` : ""}
        </section>
      `;
    }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sitemap Validation Report</title>
<style>
:root {
  --ink:#17202a;
  --muted:#667085;
  --line:#e5e7eb;
  --panel:#ffffff;
  --bg:#f4f6f8;
  --pass:#147d4a;
  --pass-bg:#e8f6ee;
  --fail:#b42318;
  --fail-bg:#fff0ef;
  --warn:#9a6700;
  --warn-bg:#fff7df;
  --accent:#2457c5;
}
* { box-sizing:border-box; }
body {
  margin:0;
  background:var(--bg);
  color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
}
.container { max-width:1440px; margin:0 auto; padding:40px; }
.header {
  background:#17202a;
  color:white;
  padding:42px 48px;
  border-radius:20px;
  margin-bottom:24px;
}
.header .eyebrow, .eyebrow { font-size:12px; letter-spacing:.12em; font-weight:700; opacity:.7; }
.header h1 { margin:8px 0 6px; font-size:34px; }
.header p { margin:0; color:#cbd5e1; }
.summary-grid {
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:14px;
  margin-bottom:24px;
}
.card {
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:14px;
  padding:20px;
}
.card span { display:block; color:var(--muted); font-size:12px; margin-bottom:8px; }
.card strong { font-size:27px; }
.overall {
  grid-column:span 5;
  display:flex;
  align-items:center;
  justify-content:space-between;
  background:${overallPass ? "var(--pass-bg)" : "var(--fail-bg)"};
  border:1px solid ${overallPass ? "#b9e4ca" : "#f3c4c0"};
}
.overall .label { font-size:14px; font-weight:700; }
.overall .result { font-size:24px; font-weight:800; color:${overallPass ? "var(--pass)" : "var(--fail)"}; }
.site-section {
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:18px;
  padding:28px;
  margin-bottom:24px;
}
.section-title { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:24px; }
.section-title h2 { margin:5px 0 0; font-size:22px; word-break:break-all; }
.hero-pass,.hero-fail { padding:9px 14px; border-radius:999px; font-weight:800; font-size:13px; }
.hero-pass { background:var(--pass-bg); color:var(--pass); }
.hero-fail { background:var(--fail-bg); color:var(--fail); }
.facts { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:30px; }
.facts div { border:1px solid var(--line); border-radius:12px; padding:14px; }
.facts span { display:block; color:var(--muted); font-size:11px; margin-bottom:7px; }
.facts strong { display:block; font-size:14px; word-break:break-word; }
h3 { margin:28px 0 12px; font-size:16px; }
.table-wrap { overflow:auto; border:1px solid var(--line); border-radius:12px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { background:#f8fafc; color:#475467; font-weight:700; text-align:left; white-space:nowrap; }
th,td { padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
tr:last-child td { border-bottom:0; }
.badge { display:inline-block; min-width:64px; text-align:center; padding:5px 8px; border-radius:999px; font-size:11px; font-weight:800; }
.badge.pass { background:var(--pass-bg); color:var(--pass); }
.badge.fail { background:var(--fail-bg); color:var(--fail); }
.badge.skip { background:#eef2f6; color:#667085; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:#475467; }
.url { max-width:600px; word-break:break-all; }
.redirects { display:grid; gap:8px; }
.redirects div { background:#f8fafc; padding:10px 12px; border-radius:9px; display:flex; gap:10px; flex-wrap:wrap; word-break:break-all; }
.redirects b { color:var(--accent); }
.muted { color:var(--muted); font-size:13px; }
/* Failure evidence is deliberately separated from the compact PASS/FAIL matrix. */
.failure-evidence-panel {
  margin-top: 30px;
  border: 1px solid #f1b7b1;
  border-radius: 14px;
  background: #fffafa;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(180, 35, 24, .06);
}
.failure-evidence-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  background: #fff3f1;
  border-bottom: 1px solid #f1c7c2;
}
.failure-evidence-header h3 {
  margin: 3px 0 4px;
  font-size: 17px;
  color: #8f1d14;
}
.failure-evidence-header p {
  margin: 0;
  color: #7a4a45;
  font-size: 12px;
}
.danger-eyebrow { color: #b42318; opacity: 1; }
.failure-evidence-stats { display:flex; gap:8px; flex-wrap:wrap; }
.failure-stat, .review-stat {
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.failure-stat { background:#fde8e6; color:#b42318; }
.review-stat { background:#fff2cf; color:#8a5a00; }
.failure-evidence-list { padding: 12px; display:grid; gap:10px; }
.check-details {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}
.check-details summary {
  cursor: pointer;
  list-style: none;
  padding: 13px 14px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  font-size: 13px;
}
.check-details summary::-webkit-details-marker { display:none; }
.check-details summary::after { content:"▸"; color:#667085; margin-left:auto; }
.check-details[open] summary::after { content:"▾"; }
.fail-detail { border-left: 4px solid #d92d20; }
.warning-detail { border-left: 4px solid #d69e2e; }
.fail-detail summary { background:#fff7f6; color:#8f1d14; }
.warning-detail summary { background:#fffaf0; color:#7a5200; }
.summary-left { display:flex; align-items:center; gap:9px; min-width:0; }
.detail-icon {
  width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center;
  border-radius:50%; font-weight:900; flex:0 0 auto;
}
.fail-detail .detail-icon { background:#fde8e6; color:#b42318; }
.warning-detail .detail-icon { background:#fff0c7; color:#8a5a00; }
.detail-kind {
  font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
  opacity:.65;
}
.summary-count { font-size:11px; color:#667085; white-space:nowrap; }
.check-details > p { margin: 0; padding: 0 14px 12px; color:#475467; font-size:12px; }
.flagged-list {
  margin: 0 14px 14px;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  background: #fafbfc;
  padding: 10px 14px;
  max-height: 360px;
  overflow: auto;
}
.flagged-list .list-header { font-weight:800; font-size:12px; margin-bottom:7px; color:#344054; }
.flagged-list ol, .slash-columns ol { margin:0; padding-left:24px; }
.flagged-list li, .slash-columns li { margin: 4px 0; font-size:12px; line-height:1.45; }
.evidence-card {
  margin: 0 14px 14px;
  padding: 12px;
  border: 1px solid #e4e7ec;
  border-radius: 9px;
  background: #f8fafc;
  font-size:12px;
}
.evidence-card pre {
  margin:10px 0 0;
  padding:10px;
  background:#111827;
  color:#e5e7eb;
  border-radius:7px;
  overflow:auto;
  font-size:11px;
  line-height:1.5;
}
.nested-details { margin: 0 14px 14px; }
.nested-details summary {
  cursor:pointer; font-size:12px; font-weight:700; color:#344054;
  padding:9px 10px; background:#f8fafc; border:1px solid #e4e7ec; border-radius:8px;
}
.slash-columns {
  display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:0 14px 14px;
}
.slash-columns > div {
  border:1px solid #e4e7ec; border-radius:9px; padding:12px; background:#fafbfc;
  max-height:360px; overflow:auto;
}
.slash-columns h4 { margin:0 0 8px; font-size:12px; color:#344054; }
@media(max-width:700px) {
  .failure-evidence-header { align-items:flex-start; flex-direction:column; }
  .slash-columns { grid-template-columns:1fr; }
}
.notice { margin-top:18px; padding:14px 16px; border-radius:10px; font-size:13px; }
.notice.warning { background:var(--warn-bg); color:var(--warn); }
.notice.danger { background:var(--fail-bg); color:var(--fail); }
code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.footer { color:var(--muted); font-size:12px; text-align:center; padding:10px 0 30px; }
@media(max-width:1000px) {
  .summary-grid { grid-template-columns:repeat(2,1fr); }
  .overall { grid-column:span 2; }
  .facts { grid-template-columns:repeat(2,1fr); }
}
@media(max-width:650px) {
  .container { padding:16px; }
  .header { padding:28px; }
  .summary-grid,.facts { grid-template-columns:1fr; }
  .overall { grid-column:span 1; }
}
@media print {
  body { background:white; }
  .container { max-width:none; padding:0; }
  .header,.site-section,.card { break-inside:avoid; }
  .table-wrap { overflow:visible; }
}
</style>
</head>
<body>
<div class="container">
  <header class="header">
    <div class="eyebrow">QA AUTOMATION DELIVERABLE</div>
    <h1>Sitemap Validation Report</h1>
    <p>Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</p>
  </header>

  <div class="summary-grid">
    <div class="overall card">
      <div>
        <div class="label">OVERALL RESULT</div>
        <div>${overallPass ? "All enabled sitemap checks passed." : "One or more sitemap validation checks failed."}</div>
      </div>
      <div class="result">${overallPass ? "PASS" : "FAIL"}</div>
    </div>

    <div class="card"><span>Sites Tested</span><strong>${formatNumber(report.summary.totalSites)}</strong></div>
    <div class="card"><span>Sites Passed</span><strong>${formatNumber(passedSites)}</strong></div>
    <div class="card"><span>Sites Failed</span><strong>${formatNumber(failedSites)}</strong></div>
    <div class="card"><span>URLs Discovered</span><strong>${formatNumber(totalUrls)}</strong></div>
    <div class="card"><span>Failed Checks</span><strong>${formatNumber(failedChecks)}</strong></div>
    <div class="card"><span>HTTP URLs Checked</span><strong>${formatNumber(statusChecked)}</strong></div>
    <div class="card"><span>HTTP Failures</span><strong>${formatNumber(statusFailures)}</strong></div>
  </div>

  ${siteSections}

  <div class="footer">
    Playwright Sitemap Validator v5 · XLSX and JSON technical deliverables accompany this report.
  </div>
</div>
</body>
</html>`;

  fs.writeFileSync(
    outputFile,
    html,
    "utf8"
  );
}
