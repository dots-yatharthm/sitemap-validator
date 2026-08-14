import {
  isFuture,
  isValidIso8601,
  suffixNearDuplicatePairs
} from "./utils.js";

const MAX_URLS = 50_000;
const MAX_BYTES = 50 * 1024 * 1024;

function result(
  name,
  enabled,
  passed,
  message,
  counts = {},
  flaggedUrls = [],
  details = undefined
) {
  return {
    name,
    enabled,
    passed,
    status: enabled
      ? (passed ? "pass" : "fail")
      : "skip",
    message,
    counts,
    flaggedUrls,
    details
  };
}

export function checkWellFormedness(
  enabled,
  sitemapWellFormed,
  namespaceValid,
  errors,
  evidence = []
) {
  if (!enabled) {
    return result(
      "wellFormedness",
      false,
      true,
      "Skipped."
    );
  }

  const passed =
    sitemapWellFormed &&
    namespaceValid;

  return result(
    "wellFormedness",
    true,
    passed,
    passed
      ? "Sitemap structure and namespace are valid."
      : "Sitemap structure or namespace validation failed.",
    { errors: errors.length },
    [],
    { errors, evidence }
  );
}

export function checkUrlCount(
  enabled,
  totalUrls,
  files,
  entries = []
) {
  if (!enabled) {
    return result(
      "urlCount",
      false,
      true,
      "Skipped."
    );
  }

  const oversized = files.filter(
    (file) => file.bytes > MAX_BYTES
  );

  const overUrlLimit = files.filter(
    (file) => file.extractedUrls > MAX_URLS
  );

  const passed =
    oversized.length === 0 &&
    overUrlLimit.length === 0;

  const affectedFiles = [
    ...oversized,
    ...overUrlLimit
  ];

  const affectedFileUrls = new Set(
    affectedFiles.map((file) => file.url)
  );

  const flagged = entries
    .filter((entry) => affectedFileUrls.has(entry.sourceSitemap))
    .map((entry) => entry.loc);

  return result(
    "urlCount",
    true,
    passed,
    passed
      ? "Every sitemap file is within the 50,000 URL and 50 MB protocol limits."
      : "One or more sitemap files exceed the 50,000 URL and/or 50 MB limit; split the affected file(s).",
    {
      totalUrls,
      filesChecked: files.length,
      oversizedFiles: oversized.length,
      overUrlLimitFiles: overUrlLimit.length,
      affectedUrls: flagged.length
    },
    flagged,
    {
      maxUrls: MAX_URLS,
      maxBytes: MAX_BYTES,
      oversizedFiles: oversized,
      overUrlLimitFiles: overUrlLimit,
      affectedSitemapFiles: affectedFiles.map((file) => file.url),
      affectedUrls: flagged
    }
  );
}

export function checkUrlFormat(enabled, urls) {
  if (!enabled) {
    return result(
      "urlFormat",
      false,
      true,
      "Skipped."
    );
  }

  const invalid = [];

  for (const raw of urls) {
    try {
      const url = new URL(raw);

      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        /\s/.test(raw) ||
        /[\u0000-\u001F\u007F]/.test(raw)
      ) {
        invalid.push(raw);
      }
    } catch {
      invalid.push(raw);
    }
  }

  const unique = [...new Set(invalid)];

  return result(
    "urlFormat",
    true,
    unique.length === 0,
    unique.length
      ? "Invalid URL format found."
      : "All URLs are absolute HTTPS URLs with valid URL structure and no unencoded whitespace.",
    { invalidUrls: unique.length },
    unique
  );
}

export function checkExactDuplicates(enabled, urls) {
  if (!enabled) {
    return result(
      "exactDuplicates",
      false,
      true,
      "Skipped."
    );
  }

  const seen = new Map();

  for (const url of urls) {
    seen.set(
      url,
      (seen.get(url) ?? 0) + 1
    );
  }

  const duplicates = [...seen.entries()]
    .filter(([, count]) => count > 1);

  return result(
    "exactDuplicates",
    true,
    duplicates.length === 0,
    duplicates.length
      ? "Exact duplicate URLs found."
      : "No exact duplicate URLs found.",
    {
      duplicateUrls: duplicates.length,
      duplicateOccurrences:
        duplicates.reduce(
          (n, [, count]) =>
            n + count - 1,
          0
        )
    },
    duplicates.map(([url]) => url),
    duplicates
  );
}

export function checkSuffixNearDuplicates(
  enabled,
  urls
) {
  if (!enabled) {
    return result(
      "suffixNearDuplicates",
      false,
      true,
      "Skipped."
    );
  }

  const pairs =
    suffixNearDuplicatePairs(urls);

  const flagged = [
    ...new Set(pairs.flat())
  ];

  return result(
    "suffixNearDuplicates",
    true,
    true,
    flagged.length
      ? "Potential suffix near-duplicates found; review manually. This is not an automatic failure."
      : "No /x and /x-2 style near-duplicates found.",
    {
      pairs: pairs.length,
      flaggedUrls: flagged.length
    },
    flagged,
    pairs
  );
}

export function checkHostConsistency(
  enabled,
  urls,
  scope
) {
  if (!enabled) {
    return result(
      "hostConsistency",
      false,
      true,
      "Skipped."
    );
  }

  const invalid = urls.filter((raw) => {
    try {
      const url = new URL(raw);

      return (
        url.protocol !== "https:" ||
        url.hostname !== scope.hostname ||
        !url.pathname.startsWith(scope.pathPrefix)
      );
    } catch {
      return true;
    }
  });

  return result(
    "hostConsistency",
    true,
    invalid.length === 0,
    invalid.length
      ? `URLs outside expected scope ${scope.hostname}${scope.pathPrefix} were found.`
      : "All URLs match the expected host and path scope.",
    { outOfScopeUrls: invalid.length },
    invalid
  );
}

export function checkTrailingSlashConsistency(
  enabled,
  urls
) {
  if (!enabled) {
    return result(
      "trailingSlashConsistency",
      false,
      true,
      "Skipped."
    );
  }

  let withSlash = 0;
  let withoutSlash = 0;
  const withSlashUrls = [];
  const withoutSlashUrls = [];

  for (const raw of urls) {
    try {
      const pathname = new URL(raw).pathname;

      // The site root "/" is itself the canonical trailing-slash form.
      // Count it in the trailing-slash bucket so the two buckets reconcile
      // to the total sitemap URL count.
      if (
        pathname === "/" ||
        pathname.endsWith("/")
      ) {
        withSlash++;
        withSlashUrls.push(raw);
      } else {
        withoutSlash++;
        withoutSlashUrls.push(raw);
      }
    } catch {}
  }

  const mixed =
    withSlash > 0 &&
    withoutSlash > 0;

  return result(
    "trailingSlashConsistency",
    true,
    !mixed,
    mixed
      ? "Mixed trailing-slash usage detected."
      : "Trailing-slash usage is consistent.",
    {
      withTrailingSlash: withSlash,
      withoutTrailingSlash: withoutSlash
    },
    mixed ? withoutSlashUrls : [],
    {
      withTrailingSlashUrls: withSlashUrls,
      withoutTrailingSlashUrls: withoutSlashUrls
    }
  );
}

export function checkLastmod(
  enabled,
  entries
) {
  if (!enabled) {
    return result(
      "lastmodValidity",
      false,
      true,
      "Skipped."
    );
  }

  const invalid = [];
  const future = [];
  let present = 0;

  for (const entry of entries) {
    if (!entry.lastmod) continue;

    present++;

    if (!isValidIso8601(entry.lastmod)) {
      invalid.push(entry.loc);
      continue;
    }

    if (isFuture(entry.lastmod)) {
      future.push(entry.loc);
    }
  }

  const flagged = [
    ...new Set([
      ...invalid,
      ...future
    ])
  ];

  return result(
    "lastmodValidity",
    true,
    flagged.length === 0,
    flagged.length
      ? "Invalid or future lastmod values found."
      : "All supplied lastmod values are valid and not in the future.",
    {
      lastmodPresent: present,
      invalid: invalid.length,
      future: future.length
    },
    flagged,
    { invalid, future }
  );
}

export function makeStatusResult(
  enabled,
  mode,
  checked,
  failures
) {
  if (!enabled || mode === "none") {
    return result(
      "status",
      false,
      true,
      "Status check disabled.",
      {
        checked: 0,
        failures: 0
      }
    );
  }

  return result(
    "status",
    true,
    failures.length === 0,
    failures.length
      ? "One or more sampled/full URLs did not resolve with HTTP 200."
      : "All checked URLs returned HTTP 200.",
    {
      checked,
      failures: failures.length
    },
    failures.map((item) => item.url),
    failures
  );
}

export function allChecks(
  config,
  sitemap,
  entries,
  files,
  scope,
  wellFormedEvidence = []
) {
  const urls =
    entries.map((entry) => entry.loc);

  return [
    checkWellFormedness(
      config.checks.wellFormedness,
      sitemap.wellFormed,
      sitemap.namespaceValid,
      sitemap.errors,
      wellFormedEvidence
    ),
    checkUrlCount(
      config.checks.urlCount,
      urls.length,
      files,
      entries
    ),
    checkUrlFormat(
      config.checks.urlFormat,
      urls
    ),
    checkExactDuplicates(
      config.checks.exactDuplicates,
      urls
    ),
    checkSuffixNearDuplicates(
      config.checks.suffixNearDuplicates,
      urls
    ),
    checkHostConsistency(
      config.checks.hostConsistency,
      urls,
      scope
    ),
    checkTrailingSlashConsistency(
      config.checks.trailingSlashConsistency,
      urls
    ),
    checkLastmod(
      config.checks.lastmodValidity,
      entries
    )
  ];
}
