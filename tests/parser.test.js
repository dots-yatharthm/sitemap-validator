import assert from "node:assert/strict";
import { parseSitemap } from "../src/parser.js";

const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="//www.multidots.com/main-sitemap.xsl"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.multidots.com/post-sitemap.xml</loc><lastmod>2026-08-13 14:31 +00:00</lastmod></sitemap>
  <sitemap><loc>https://www.multidots.com/page-sitemap.xml</loc><lastmod>2026-08-12 08:34 +00:00</lastmod></sitemap>
  <sitemap><loc>https://www.multidots.com/works-sitemap.xml</loc><lastmod>2026-08-04 10:01 +00:00</lastmod></sitemap>
  <sitemap><loc>https://www.multidots.com/multipack-sitemap.xml</loc><lastmod>2026-08-12 09:04 +00:00</lastmod></sitemap>
  <sitemap><loc>https://www.multidots.com/category-sitemap.xml</loc><lastmod>2026-08-13 14:31 +00:00</lastmod></sitemap>
  <sitemap><loc>https://www.multidots.com/author-sitemap.xml</loc><lastmod>2026-08-08 04:55 +00:00</lastmod></sitemap>
  <sitemap><loc>https://www.multidots.com/geo-sitemap.xml</loc><lastmod>2026-04-01 11:48 +00:00</lastmod></sitemap>
</sitemapindex>`;

const parsedIndex = parseSitemap(
  "https://www.multidots.com/sitemap_index.xml",
  Buffer.from(indexXml),
  "text/xml"
);

assert.equal(parsedIndex.type, "xml-index");
assert.equal(parsedIndex.wellFormed, true);
assert.equal(parsedIndex.namespaceValid, true);
assert.equal(parsedIndex.childSitemaps.length, 7);

const counts = [307, 59, 34, 10, 8, 19, 1];
const childNames = [
  "post-sitemap.xml",
  "page-sitemap.xml",
  "works-sitemap.xml",
  "multipack-sitemap.xml",
  "category-sitemap.xml",
  "author-sitemap.xml",
  "geo-sitemap.xml"
];

let total = 0;

for (let i = 0; i < childNames.length; i++) {
  const urls = Array.from(
    { length: counts[i] },
    (_, index) =>
      `<url><loc>https://www.multidots.com/test-${i}-${index + 1}/</loc><lastmod>2026-08-13</lastmod></url>`
  ).join("");

  const childXml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  const parsedChild = parseSitemap(
    `https://www.multidots.com/${childNames[i]}`,
    Buffer.from(childXml),
    "text/xml"
  );

  assert.equal(parsedChild.type, "xml-urlset");
  assert.equal(parsedChild.wellFormed, true);
  assert.equal(parsedChild.namespaceValid, true);
  assert.equal(parsedChild.entries.length, counts[i]);

  total += parsedChild.entries.length;
}

assert.equal(total, 438);

const simpleXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="//www.example.com/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/hello-world/</loc>
    <lastmod>2026-08-13</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`;

const simple = parseSitemap(
  "https://www.example.com/sitemap.xml",
  Buffer.from(simpleXml),
  "text/xml"
);

assert.equal(simple.type, "xml-urlset");
assert.equal(simple.entries.length, 1);
assert.equal(simple.entries[0].lastmod, "2026-08-13");
assert.equal(simple.entries[0].changefreq, "weekly");
assert.equal(simple.entries[0].priority, "0.8");

console.log("PASS: Yoast XML declaration + stylesheet PI + sitemap index parsed correctly.");
console.log("PASS: 7 child sitemap URLs detected.");
console.log("PASS: Fixture child sitemap counts total exactly 438 URLs.");
console.log("PASS: XML urlset metadata extraction works.");

// Regression fixture for extension-heavy WordPress video sitemaps where
// a subset of <loc> values may be wrapped in CDATA. The validator must not
// silently lose URL entries when the XML parser represents those nodes differently.
const videoEntries = Array.from({ length: 72 }, (_, index) => {
  const i = index + 1;
  const loc = `https://www.multicollab.com/video-${i}/`;
  const locMarkup = i <= 15 ? `<![CDATA[${loc}]]>` : loc;
  return `<url><loc>${locMarkup}</loc><lastmod>2026-08-14</lastmod><video:video><video:title>Video ${i}</video:title></video:video></url>`;
}).join('');

const videoXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${videoEntries}</urlset>`;

const parsedVideo = parseSitemap(
  'https://www.multicollab.com/video-sitemap.xml',
  Buffer.from(videoXml),
  'text/xml'
);

assert.equal(parsedVideo.type, 'xml-urlset');
assert.equal(parsedVideo.wellFormed, true);
assert.equal(parsedVideo.namespaceValid, true);
assert.equal(parsedVideo.entries.length, 72);
assert.equal(parsedVideo.entries[0].loc, 'https://www.multicollab.com/video-1/');
assert.equal(parsedVideo.entries[14].loc, 'https://www.multicollab.com/video-15/');
assert.equal(parsedVideo.entries[71].loc, 'https://www.multicollab.com/video-72/');

console.log('PASS: video sitemap fixture preserves all 72 <url><loc> entries, including CDATA loc values.');
