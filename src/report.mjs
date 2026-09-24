// Turning check results into output. Everything here is PURE: given the same
// results it produces the same human string / JSON object and the same exit
// intent. Colors are applied through an injected styler, so tests can assert
// on plain text.

/** A no-op styler used when the caller doesn't provide one (e.g. in tests). */
function identityStyler() {
  const id = (s) => String(s);
  return { red: id, green: id, yellow: id, cyan: id, dim: id, bold: id, enabled: false };
}

/**
 * Tally results.
 * @param {object[]} results
 */
export function summarize(results) {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let errorFailures = 0;
  for (const r of results) {
    if (r.ok) {
      passed += 1;
    } else {
      failed += 1;
      if (r.severity === 'warn') warnings += 1;
      else errorFailures += 1;
    }
  }
  return {
    total: results.length,
    passed,
    failed,
    warnings,
    errorFailures,
    ready: errorFailures === 0,
  };
}

/** Exit code intent: 1 if any error-severity check failed, else 0. */
export function exitCodeFor(results) {
  return summarize(results).errorFailures > 0 ? 1 : 0;
}

function labelFor(r) {
  if (r.type === 'env') return `env ${r.name}`;
  return r.name;
}

function summaryLine(results, c) {
  const s = summarize(results);
  if (s.failed === 0) {
    const noun = s.passed === 1 ? 'check' : 'checks';
    return c.green(`All ${s.passed} ${noun} passed. Environment is ready.`);
  }
  if (s.errorFailures > 0) {
    const noun = s.failed === 1 ? 'problem' : 'problems';
    return c.red(`${s.failed} ${noun} found. Environment is NOT ready.`);
  }
  const noun = s.warnings === 1 ? 'warning' : 'warnings';
  return c.yellow(`${s.warnings} ${noun}. Environment is usable, but review the warnings.`);
}

/**
 * Render a human-readable report.
 * @param {object[]} results
 * @param {{ styler?: object, compact?: boolean }} [opts]
 * @returns {string}
 */
export function formatHuman(results, opts = {}) {
  const c = opts.styler || identityStyler();
  const compact = Boolean(opts.compact);
  const out = [];

  if (!compact) {
    out.push(c.bold('envcheck \u2014 environment report'));
    out.push('');
  }

  if (results.length === 0) {
    if (compact) {
      out.push('no requirements found');
    } else {
      out.push(c.dim('  no requirements found \u2014 add an envcheck.json or a package.json "engines" field.'));
      out.push('');
      out.push('Nothing to check.');
    }
    return out.join('\n');
  }

  const labels = results.map(labelFor);
  const statuses = results.map((r) => r.status);
  const lw = Math.max(...labels.map((s) => s.length));
  const sw = Math.max(...statuses.map((s) => s.length));

  results.forEach((r, i) => {
    const sym = r.ok
      ? c.green('\u2713')
      : r.severity === 'warn' ? c.yellow('\u26a0') : c.red('\u2717');
    const label = labels[i].padEnd(lw);
    const statusPlain = statuses[i].padEnd(sw);
    const status = r.ok
      ? c.green(statusPlain)
      : r.severity === 'warn' ? c.yellow(statusPlain) : c.red(statusPlain);
    let line = `  ${sym} ${label}  ${status}`;
    if (r.note) line += `  ${c.dim(`(${r.note})`)}`;
    if (r.hint) line += `  ${c.cyan(`\u2192 ${r.hint}`)}`;
    out.push(line.replace(/\s+$/, ''));
  });

  if (!compact) out.push('');
  out.push(summaryLine(results, c));
  return out.join('\n');
}

/**
 * Build the machine-readable report object (for `--json`).
 * SECRET-SAFE: env checks only ever carry a name and present/missing status.
 * @param {object[]} results
 * @param {{ source?: string, configPath?: string|null }} [meta]
 */
export function toJson(results, meta = {}) {
  const s = summarize(results);
  return {
    ok: s.ready,
    ready: s.ready,
    summary: {
      total: s.total,
      passed: s.passed,
      failed: s.failed,
      warnings: s.warnings,
      errors: s.errorFailures,
    },
    source: meta.source || null,
    checks: results.map((r) => ({
      type: r.type,
      name: r.name,
      ok: r.ok,
      severity: r.severity,
      status: r.status,
      found: r.found ?? null,
      range: r.range ?? null,
    })),
  };
}
