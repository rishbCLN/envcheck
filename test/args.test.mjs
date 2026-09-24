import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, HELP } from '../src/args.mjs';

test('parseArgs: sensible defaults with no args', () => {
  const r = parseArgs([]);
  assert.deepEqual(r, {
    config: null,
    init: false,
    json: false,
    ci: false,
    help: false,
    version: false,
    errors: [],
  });
});

test('parseArgs: flags', () => {
  const r = parseArgs(['--json', '--ci', '--init']);
  assert.equal(r.json, true);
  assert.equal(r.ci, true);
  assert.equal(r.init, true);
  assert.deepEqual(r.errors, []);
});

test('parseArgs: --config <file> and --config=<file>', () => {
  assert.equal(parseArgs(['--config', 'env.json']).config, 'env.json');
  assert.equal(parseArgs(['--config=custom/env.json']).config, 'custom/env.json');
});

test('parseArgs: --config without a value is an error', () => {
  const r = parseArgs(['--config']);
  assert.ok(r.errors.some((e) => /--config requires a file path/.test(e)));
  assert.equal(parseArgs(['--config=']).errors.length, 1);
});

test('parseArgs: --config does not swallow a following flag (regression)', () => {
  // A forgotten value must not eat the next flag; it must error instead.
  const r = parseArgs(['--config', '--json']);
  assert.equal(r.config, null); // --json was NOT consumed as the config path
  assert.equal(r.json, true); // it was parsed as its own flag instead
  assert.ok(r.errors.some((e) => /--config requires a file path/.test(e)));
  // Normal space and inline forms still parse.
  assert.equal(parseArgs(['--config', 'env.json']).config, 'env.json');
  assert.equal(parseArgs(['--config=custom/env.json']).config, 'custom/env.json');
});

test('parseArgs: help and version, short and long', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.equal(parseArgs(['--version']).version, true);
});

test('parseArgs: unknown option and unexpected positional are errors', () => {
  assert.ok(parseArgs(['--bogus']).errors.some((e) => /unknown option/.test(e)));
  assert.ok(parseArgs(['3000']).errors.some((e) => /unexpected argument/.test(e)));
});

test('HELP: mentions the secret-safety guarantee', () => {
  assert.match(HELP, /never prints environment variable values/i);
});
