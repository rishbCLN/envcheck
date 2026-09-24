// Loading, validating, and (when absent) inferring the envcheck config.
//
// Everything that touches disk goes through injectable `readFileSync` /
// `existsSync` so the loader is fully testable. Validation and parsing are
// pure. A malformed config yields a clear list of offending keys rather than a
// thrown stack trace.
import { readFileSync as fsReadFileSync, existsSync as fsExistsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isSafeCommandName } from './checks.mjs';

/** The shape every consumer downstream can rely on. */
function emptyConfig() {
  return { commands: [], files: [], env: { vars: [], fromExample: null } };
}

/**
 * Parse a `.env.example` file into a list of variable NAMES.
 * Ignores blank lines and `#` comments, tolerates an `export ` prefix and
 * `KEY=value` / `KEY=` / bare `KEY` forms, and NEVER looks at the values.
 * @param {string} text
 * @returns {string[]} unique names, in first-seen order
 */
export function parseEnvExample(text) {
  const names = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const body = line.replace(/^export\s+/, '');
    const eq = body.indexOf('=');
    const name = (eq === -1 ? body : body.slice(0, eq)).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.push(name);
  }
  return [...new Set(names)];
}

/**
 * Turn a package.json `engines` map into command checks.
 * @param {unknown} engines
 * @returns {Array<{ name: string, range: string, severity: string, hint: null }>}
 */
export function inferCommandsFromEngines(engines) {
  if (!engines || typeof engines !== 'object') return [];
  const out = [];
  for (const [name, range] of Object.entries(engines)) {
    if (typeof range === 'string' && isSafeCommandName(name)) {
      out.push({ name, range, severity: 'error', hint: null });
    }
  }
  return out;
}

/**
 * Validate raw parsed JSON into a normalized config.
 * @param {unknown} raw
 * @returns {{ config: object, errors: string[] }}
 */
export function validateConfig(raw) {
  const errors = [];
  const config = emptyConfig();

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('config root must be a JSON object');
    return { config, errors };
  }

  const allowed = new Set(['commands', 'env', 'files']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) errors.push(`unknown key: "${key}" (allowed: commands, env, files)`);
  }

  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands)) {
      errors.push('"commands" must be an array');
    } else {
      raw.commands.forEach((item, i) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`commands[${i}] must be an object`);
          return;
        }
        const validName = typeof item.name === 'string' && item.name.trim() !== '';
        if (!validName) {
          errors.push(`commands[${i}].name is required and must be a non-empty string`);
        } else if (!isSafeCommandName(item.name)) {
          errors.push(`commands[${i}].name "${item.name}" has invalid characters`);
        }
        if (item.range !== undefined && typeof item.range !== 'string') {
          errors.push(`commands[${i}].range must be a string`);
        }
        if (item.severity !== undefined && item.severity !== 'error' && item.severity !== 'warn') {
          errors.push(`commands[${i}].severity must be "error" or "warn"`);
        }
        if (item.hint !== undefined && typeof item.hint !== 'string') {
          errors.push(`commands[${i}].hint must be a string`);
        }
        if (validName && isSafeCommandName(item.name)) {
          config.commands.push({
            name: item.name,
            range: item.range == null || item.range === '' ? '*' : item.range,
            severity: item.severity === 'warn' ? 'warn' : 'error',
            hint: typeof item.hint === 'string' ? item.hint : null,
          });
        }
      });
    }
  }

  if (raw.env !== undefined) {
    if (raw.env === null || typeof raw.env !== 'object' || Array.isArray(raw.env)) {
      errors.push('"env" must be an object');
    } else {
      const envAllowed = new Set(['required', 'fromExample']);
      for (const k of Object.keys(raw.env)) {
        if (!envAllowed.has(k)) errors.push(`unknown key: "env.${k}" (allowed: required, fromExample)`);
      }
      if (raw.env.required !== undefined) {
        if (!Array.isArray(raw.env.required)) {
          errors.push('"env.required" must be an array of strings');
        } else {
          raw.env.required.forEach((n, i) => {
            if (typeof n !== 'string' || n.trim() === '') {
              errors.push(`env.required[${i}] must be a non-empty string`);
            } else {
              config.env.vars.push({ name: n, source: 'required' });
            }
          });
        }
      }
      if (raw.env.fromExample !== undefined) {
        if (typeof raw.env.fromExample !== 'string' || raw.env.fromExample.trim() === '') {
          errors.push('"env.fromExample" must be a string (path to an example env file)');
        } else {
          config.env.fromExample = raw.env.fromExample;
        }
      }
    }
  }

  if (raw.files !== undefined) {
    if (!Array.isArray(raw.files)) {
      errors.push('"files" must be an array');
    } else {
      raw.files.forEach((f, i) => {
        if (typeof f === 'string') {
          if (f.trim() === '') errors.push(`files[${i}] must be a non-empty string`);
          else config.files.push({ path: f, severity: 'error', hint: null });
        } else if (f && typeof f === 'object' && !Array.isArray(f)) {
          if (typeof f.path !== 'string' || f.path.trim() === '') {
            errors.push(`files[${i}].path is required and must be a non-empty string`);
          } else {
            config.files.push({
              path: f.path,
              severity: f.severity === 'warn' ? 'warn' : 'error',
              hint: typeof f.hint === 'string' ? f.hint : null,
            });
          }
          if (f.severity !== undefined && f.severity !== 'error' && f.severity !== 'warn') {
            errors.push(`files[${i}].severity must be "error" or "warn"`);
          }
        } else {
          errors.push(`files[${i}] must be a string or an object with a "path"`);
        }
      });
    }
  }

  return { config, errors };
}

/** Merge names from an example env file into a config's env var list. */
function mergeExampleEnv(config, cwd, readFile, exists) {
  const ex = config.env.fromExample;
  if (!ex) return;
  const full = isAbsolute(ex) ? ex : join(cwd, ex);
  if (!exists(full)) return;
  let text;
  try { text = readFile(full, 'utf8'); } catch { return; }
  const have = new Set(config.env.vars.map((v) => v.name));
  for (const name of parseEnvExample(text)) {
    if (!have.has(name)) {
      config.env.vars.push({ name, source: ex });
      have.add(name);
    }
  }
}

/**
 * Infer a config from the project when there is no envcheck.json:
 * commands from package.json `engines`, env vars from `.env.example`.
 * @param {{ cwd?: string, readFileSync?: Function, existsSync?: Function }} [opts]
 */
export function inferConfig(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const readFile = opts.readFileSync || fsReadFileSync;
  const exists = opts.existsSync || fsExistsSync;
  const config = emptyConfig();
  let found = false;

  const pkgPath = join(cwd, 'package.json');
  if (exists(pkgPath)) {
    try {
      const pkg = JSON.parse(readFile(pkgPath, 'utf8'));
      const cmds = inferCommandsFromEngines(pkg.engines);
      if (cmds.length) {
        config.commands.push(...cmds);
        found = true;
      }
    } catch { /* a broken package.json just means nothing to infer */ }
  }

  const exPath = join(cwd, '.env.example');
  if (exists(exPath)) {
    try {
      const names = parseEnvExample(readFile(exPath, 'utf8'));
      if (names.length) {
        config.env.fromExample = '.env.example';
        for (const name of names) config.env.vars.push({ name, source: '.env.example' });
        found = true;
      }
    } catch { /* ignore */ }
  }

  return { config, source: found ? 'inferred' : 'none', configPath: null, errors: [] };
}

/**
 * Load a config: from an explicit/default envcheck.json if present, otherwise
 * infer one from the project.
 * @param {{ cwd?: string, configPath?: string|null, readFileSync?: Function, existsSync?: Function }} [opts]
 * @returns {{ config: object|null, source: string, configPath: string|null, errors: string[] }}
 */
export function loadConfig(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const readFile = opts.readFileSync || fsReadFileSync;
  const exists = opts.existsSync || fsExistsSync;
  const explicit = opts.configPath || null;
  const path = explicit || join(cwd, 'envcheck.json');

  if (exists(path)) {
    let text;
    try {
      text = readFile(path, 'utf8');
    } catch (err) {
      return { config: null, source: 'config', configPath: path, errors: [`cannot read ${path}: ${err.message}`] };
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return { config: null, source: 'config', configPath: path, errors: [`${path} is not valid JSON: ${err.message}`] };
    }
    const { config, errors } = validateConfig(raw);
    if (errors.length) return { config, source: 'config', configPath: path, errors };
    mergeExampleEnv(config, cwd, readFile, exists);
    return { config, source: 'config', configPath: path, errors: [] };
  }

  if (explicit) {
    return { config: null, source: 'config', configPath: explicit, errors: [`config file not found: ${explicit}`] };
  }

  return inferConfig({ cwd, readFileSync: readFile, existsSync: exists });
}

/**
 * Build a starter envcheck.json object for `--init`, inferred from the project
 * (falling back to a sensible node>=18 template).
 * @param {{ cwd?: string, readFileSync?: Function, existsSync?: Function }} [opts]
 */
export function buildInitConfig(opts = {}) {
  const { config } = inferConfig(opts);
  const commands = config.commands.length
    ? config.commands.map((c) => ({ name: c.name, range: c.range }))
    : [{ name: 'node', range: '>=18' }];
  const required = config.env.vars.map((v) => v.name);
  return {
    commands,
    env: { required, fromExample: config.env.fromExample || '.env.example' },
    files: [],
  };
}
