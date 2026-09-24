// A tiny, dependency-free semver range comparator.
//
// It intentionally implements only the slice of the semver spec that a
// "is my tool new enough?" check needs: plain versions, `>= > <= < =`
// operators, caret (`^`), tilde (`~`), x-ranges (`1.2.x`, `1.x`, `*`),
// space-separated AND compounds (`>=16 <21`), and `||` unions. Everything here
// is PURE and heavily unit-tested — no `semver` dependency, by design.

/**
 * Parse a version-ish string into { major, minor, patch }.
 * Leniently strips a leading `v`/`=` and ignores any pre-release/build suffix,
 * so `v20.11.0`, `1.2`, and `1.2.3-beta` all parse. Returns null for junk.
 * @param {string} input
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseVersion(input) {
  if (input == null) return null;
  const m = /^[v=\s]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(input).trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: m[2] === undefined ? 0 : Number(m[2]),
    patch: m[3] === undefined ? 0 : Number(m[3]),
  };
}

/**
 * Compare two parsed versions. Returns -1, 0, or 1.
 */
export function compareVersions(a, b) {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

/**
 * Split a partial range like `1.2.x` into numeric parts, using `null` for a
 * wildcard or an omitted trailing component. Returns null for junk input.
 * @param {string} str
 * @returns {{ major: number|null, minor: number|null, patch: number|null } | null}
 */
function parseRangeParts(str) {
  const cleaned = String(str).trim().replace(/^[v=]+/, '');
  if (cleaned === '') return { major: null, minor: null, patch: null };
  const parts = cleaned.split('.');
  if (parts.length > 3) return null;
  const nums = [];
  let wildcardSeen = false;
  for (let i = 0; i < 3; i++) {
    const p = parts[i];
    if (p === undefined || p === '' || p === 'x' || p === 'X' || p === '*') {
      nums.push(null);
      wildcardSeen = true;
    } else if (!wildcardSeen && /^\d+$/.test(p)) {
      nums.push(Number(p));
    } else {
      // A fixed component after a wildcard (e.g. `1.x.3`) is meaningless, and
      // anything non-numeric is junk.
      return null;
    }
  }
  return { major: nums[0], minor: nums[1], patch: nums[2] };
}

/** x-range / plain-version match: equal on every specified leading component. */
function satisfiesXRange(v, rangeStr) {
  const r = parseRangeParts(rangeStr);
  if (!r) return false;
  if (r.major === null) return true; // `*`
  if (v.major !== r.major) return false;
  if (r.minor === null) return true;
  if (v.minor !== r.minor) return false;
  if (r.patch === null) return true;
  return v.patch === r.patch;
}

/** Caret range: allow changes that do not modify the left-most non-zero part. */
function satisfiesCaret(v, rangeStr) {
  const r = parseRangeParts(rangeStr);
  if (!r) return false;
  if (r.major === null) return true; // `^*`
  const lo = { major: r.major, minor: r.minor ?? 0, patch: r.patch ?? 0 };
  if (compareVersions(v, lo) < 0) return false;

  let hi;
  if (r.major !== 0) {
    hi = { major: r.major + 1, minor: 0, patch: 0 };
  } else if (r.minor === null) {
    hi = { major: 1, minor: 0, patch: 0 };          // ^0.x -> <1.0.0
  } else if (r.minor !== 0) {
    hi = { major: 0, minor: r.minor + 1, patch: 0 }; // ^0.2.x -> <0.3.0
  } else if (r.patch === null) {
    hi = { major: 0, minor: 1, patch: 0 };          // ^0.0.x -> <0.1.0
  } else {
    hi = { major: 0, minor: 0, patch: r.patch + 1 }; // ^0.0.3 -> <0.0.4
  }
  return compareVersions(v, hi) < 0;
}

/** Tilde range: allow patch-level changes (or minor changes when patch omitted). */
function satisfiesTilde(v, rangeStr) {
  const r = parseRangeParts(rangeStr);
  if (!r) return false;
  if (r.major === null) return true; // `~*`
  const lo = { major: r.major, minor: r.minor ?? 0, patch: r.patch ?? 0 };
  if (compareVersions(v, lo) < 0) return false;

  const hi = r.minor === null
    ? { major: r.major + 1, minor: 0, patch: 0 }     // ~1 -> <2.0.0
    : { major: r.major, minor: r.minor + 1, patch: 0 }; // ~1.2 / ~1.2.3 -> <1.3.0
  return compareVersions(v, hi) < 0;
}

/** Evaluate a single comparator token against a parsed version. */
function satisfiesComparator(v, token) {
  const range = token.trim();
  if (range === '' || range === '*' || range === 'x' || range === 'X' || range === 'latest') {
    return true;
  }
  const op = /^(>=|<=|>|<|=)\s*(.+)$/.exec(range);
  if (op) {
    const target = parseVersion(op[2]);
    if (!target) return false;
    const cmp = compareVersions(v, target);
    switch (op[1]) {
      case '>=': return cmp >= 0;
      case '<=': return cmp <= 0;
      case '>': return cmp > 0;
      case '<': return cmp < 0;
      case '=': return cmp === 0;
      default: return false;
    }
  }
  if (range[0] === '^') return satisfiesCaret(v, range.slice(1));
  if (range[0] === '~') return satisfiesTilde(v, range.slice(1));
  return satisfiesXRange(v, range);
}

/**
 * Split a space-separated AND group into individual comparator tokens. An
 * operator detached from its version by whitespace (`>= 1.2.3`) is re-joined so
 * it stays a single comparator, matching the tolerance of `satisfiesComparator`.
 * @param {string} group
 * @returns {string[]}
 */
function splitAndGroup(group) {
  const tokens = group.split(/\s+/).filter((t) => t.length > 0);
  const comparators = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^(>=|<=|>|<|=)$/.test(t) && i + 1 < tokens.length) {
      comparators.push(t + tokens[i + 1]);
      i += 1;
    } else {
      comparators.push(t);
    }
  }
  return comparators;
}

/**
 * Does `versionStr` satisfy `rangeStr`?
 * An empty/`*` range matches any parseable version. A `||` range matches if any
 * of its alternatives match; within an alternative, space-separated comparators
 * are ANDed together (`>=16 <21` honors BOTH bounds). Junk on either side is a
 * non-match (never throws).
 * @param {string} versionStr
 * @param {string} rangeStr
 * @returns {boolean}
 */
export function satisfies(versionStr, rangeStr) {
  const v = parseVersion(versionStr);
  if (!v) return false;
  const raw = rangeStr == null ? '' : String(rangeStr).trim();
  if (raw === '') return true;
  const groups = raw.split('||').map((s) => s.trim()).filter((s) => s.length > 0);
  if (groups.length === 0) return true;
  return groups.some((g) => {
    const comparators = splitAndGroup(g);
    if (comparators.length === 0) return true;
    return comparators.every((c) => satisfiesComparator(v, c));
  });
}
