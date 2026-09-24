#!/usr/bin/env node
// envcheck — one command tells you why the project won't run on a new machine.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseArgs, HELP } from '../src/args.mjs';
import { loadConfig, buildInitConfig } from '../src/config.mjs';
import { runAllChecks } from '../src/checks.mjs';
import { formatHuman, toJson, exitCodeFor } from '../src/report.mjs';
import { makeStyler, colorEnabled } from '../src/ui.mjs';

function getVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function doInit(c) {
  const target = join(process.cwd(), 'envcheck.json');
  if (existsSync(target)) {
    process.stderr.write(`${c.yellow('envcheck.json already exists')} \u2014 not overwriting.\n`);
    return 2;
  }
  const config = buildInitConfig({ cwd: process.cwd() });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write(`${c.green('\u2713')} wrote ${target}\n`);
  process.stdout.write('Edit it to describe your project\u2019s requirements, then run envcheck.\n');
  return 0;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const c = makeStyler(!opts.ci && colorEnabled());

  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`envcheck ${getVersion()}\n`);
    return 0;
  }
  if (opts.errors.length) {
    for (const e of opts.errors) process.stderr.write(`${c.red('error:')} ${e}\n`);
    process.stderr.write(`\nRun ${c.cyan('envcheck --help')} for usage.\n`);
    return 2;
  }

  if (opts.init) {
    return doInit(c);
  }

  const loaded = loadConfig({ configPath: opts.config });
  if (loaded.errors && loaded.errors.length) {
    process.stderr.write(`${c.red('error:')} invalid configuration:\n`);
    for (const e of loaded.errors) process.stderr.write(`  - ${e}\n`);
    return 2;
  }

  const results = await runAllChecks(loaded.config);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(toJson(results, { source: loaded.source, configPath: loaded.configPath }), null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHuman(results, { styler: c, compact: opts.ci })}\n`);
  }

  return exitCodeFor(results);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`unexpected error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
