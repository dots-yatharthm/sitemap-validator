import assert from 'node:assert/strict';
import { checkTrailingSlashConsistency } from '../src/checks.js';

const result = checkTrailingSlashConsistency(true, [
  'https://www.zoho.com/a/',
  'https://www.zoho.com/b',
  'https://www.zoho.com/c/',
  'https://www.zoho.com/d'
]);

assert.equal(result.status, 'fail');
assert.deepEqual(result.counts, {
  withTrailingSlash: 2,
  withoutTrailingSlash: 2
});
assert.deepEqual(result.details.withTrailingSlashUrls, [
  'https://www.zoho.com/a/',
  'https://www.zoho.com/c/'
]);
assert.deepEqual(result.details.withoutTrailingSlashUrls, [
  'https://www.zoho.com/b',
  'https://www.zoho.com/d'
]);
assert.deepEqual(result.flaggedUrls, [
  'https://www.zoho.com/b',
  'https://www.zoho.com/d'
]);

console.log('PASS: trailing-slash counts stay compact for the main table.');
console.log('PASS: with/without trailing-slash URL lists are stored in check details for HTML/XLSX evidence.');

const rootIncluded = checkTrailingSlashConsistency(true, [
  'https://www.multidots.com/',
  'https://www.multidots.com/post-a/',
  'https://www.multidots.com/post-b',
  'https://www.multidots.com/post-c/'
]);

assert.deepEqual(rootIncluded.counts, {
  withTrailingSlash: 3,
  withoutTrailingSlash: 1
});
assert.equal(
  rootIncluded.counts.withTrailingSlash + rootIncluded.counts.withoutTrailingSlash,
  4
);
assert.ok(rootIncluded.details.withTrailingSlashUrls.includes('https://www.multidots.com/'));

console.log('PASS: site-root URL "/" is counted as trailing-slash so slash buckets reconcile with total URLs.');
