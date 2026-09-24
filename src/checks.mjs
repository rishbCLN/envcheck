// The three kinds of environment checks: external commands, env vars, and files.
//
// The impure part (spawning `<cmd> --version`) is isolated behind an injectable
// `run`, and the interesting logic — pulling a version number out of arbitrary
// `--version` output, and deciding whether it satisfies a range — is kept in
// small PURE functions so it can be unit-tested without any real tools.
import { run as defaultRun } from './run.mjs';
import { satisfies } from './semver.mjs';
import { existsSync as fsExistsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * A command name is only ever passed to the shell/spawn after this guard, so it
 * must be a bare program name: an alphanumeric first char followed by a limited
 * safe set. No spaces, slashes, quotes, or shell metacharacters get through.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isSafeCommandName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/.test(name);
}

/**
 * Extract the first `x.y[.z]` version out of arbitrary `--version` output.
 * Handles e.g. "git version 2.44.0", "Docker version 24.0.7, build afdd53b",
 * "v20.11.0", "Python 3.11.4". Returns the bare version string, or null.
 * @param {string} text
 * @returns {string | null}
 */
export function extractVersion(text) {
  if (text == null) return null;
  const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(String(text));
  return m ? m[1] : null;
}

/** Heuristic: does this failed run look like "the command isn't installed"? */
function looksMissing(res) {
  if (res.error && res.error.code === 'ENOENT') return true;
  const text = `${res.stdout || ''} ${res.stderr || ''}`.toLowerCase();
  return /not recognized|not found|no such file|cannot find|no such command/.test(text);
}

function normalizeRange(range) {
  return range == null || range === '' ? '*' : String(range);
}

/**
 * Probe a command's version and compare it against a required range.
 * Never throws: a missing tool is captured and reported as a failed check.
 * @param {{ name: string, range?: string, severity?: string, hint?: string }} spec
 * @param {{ run?: typeof defaultRun, timeout?: number, shell?: boolean, platform?: NodeJS.Platform }} [opts]
 */
export async function runCommandCheck(spec, opts = {}) {
  const run = opts.run || defaultRun;
  const name = String(spec.name);
  const range = normalizeRange(spec.range);
  const severity = spec.severity === 'warn' ? 'warn' : 'error';
  const hint = spec.hint ? String(spec.hint) : null;
  const base = { type: 'command', name, range, severity, note: `required ${range}` };

  if (!isSafeCommandName(name)) {
    return {
      ...base,
      ok: false,
      found: null,
      status: 'invalid name',
      note: 'unsafe command name (refused to run)',
      hint,
    };
  }

  // Windows needs a shell to resolve `.cmd`/`.bat` wrappers (npm, npx, yarn…),
  // which bare spawn() won't find. We already validated `name` against a strict
  // charset (no spaces or shell metacharacters), so building a single command
  // string is injection-safe — and, unlike passing an args array with
  // `shell:true`, it avoids Node's DEP0190 deprecation warning.
  const shell = opts.shell != null
    ? opts.shell
    : (opts.platform || process.platform) === 'win32';
  const [probeCmd, probeArgs] = shell ? [`${name} --version`, []] : [name, ['--version']];

  let res;
  try {
    res = await run(probeCmd, probeArgs, { timeout: opts.timeout ?? 5000, shell });
  } catch (err) {
    // run() is designed never to reject; this is belt-and-suspenders.
    res = { code: -1, stdout: '', stderr: String(err), error: err };
  }

  const found = extractVersion(`${res.stdout || ''}\n${res.stderr || ''}`);
  if (found) {
    const ok = satisfies(found, range);
    return { ...base, ok, found, status: found, hint: ok ? null : hint };
  }

  const missing = looksMissing(res) || res.code !== 0;
  return {
    ...base,
    ok: false,
    found: null,
    status: missing ? 'not found' : 'unknown version',
    hint,
  };
}

/**
 * Check that an environment variable is set (to a non-empty value).
 * SECRET-SAFE: only the name and present/missing state are ever recorded —
 * the value is never read into the result or the report.
 * @param {string | { name: string, source?: string }} entry
 * @param {{ env?: Record<string,string|undefined>, hint?: string }} [opts]
 */
export function runEnvCheck(entry, opts = {}) {
  const env = opts.env || process.env;
  const name = typeof entry === 'string' ? entry : entry.name;
  const source = typeof entry === 'string' ? null : entry.source;
  const value = env[name];
  const present = value !== undefined && value !== null && String(value).length > 0;
  const note = source && source !== 'required' ? `declared in ${source}` : 'required';
  return {
    type: 'env',
    name,
    ok: present,
    severity: 'error',
    found: null, // never expose the value
    range: null,
    status: present ? 'present' : 'missing',
    note,
    hint: present ? null : (opts.hint || null),
  };
}

/**
 * Check that a required file or directory exists (relative to cwd).
 * @param {string | { path: string, severity?: string, hint?: string }} entry
 * @param {{ cwd?: string, existsSync?: (p: string) => boolean }} [opts]
 */
export function runFileCheck(entry, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const exists = opts.existsSync || fsExistsSync;
  const path = typeof entry === 'string' ? entry : entry.path;
  const severity = (entry && entry.severity === 'warn') ? 'warn' : 'error';
  const hint = (entry && entry.hint) ? String(entry.hint) : null;
  const full = isAbsolute(path) ? path : join(cwd, path);
  const present = exists(full);
  return {
    type: 'file',
    name: path,
    ok: present,
    severity,
    found: null,
    range: null,
    status: present ? 'present' : 'missing',
    note: '',
    hint: present ? null : hint,
  };
}

/**
 * Run every check described by a normalized config, preserving a stable order:
 * commands, then files, then env vars. Command probes run concurrently.
 * @param {object} config normalized config from config.mjs
 * @param {{ run?: typeof defaultRun, env?: object, cwd?: string, existsSync?: Function }} [opts]
 * @returns {Promise<object[]>}
 */
export async function runAllChecks(config, opts = {}) {
  const commands = config.commands || [];
  const files = config.files || [];
  const envVars = (config.env && config.env.vars) || [];

  const commandResults = await Promise.all(
    commands.map((cmd) => runCommandCheck(cmd, opts)),
  );
  const fileResults = files.map((f) => runFileCheck(f, opts));
  const envResults = envVars.map((e) => runEnvCheck(e, { env: opts.env }));

  return [...commandResults, ...fileResults, ...envResults];
}
