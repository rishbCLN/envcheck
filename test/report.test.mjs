import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, exitCodeFor, formatHuman, toJson } from '../src/report.mjs';

const mixed = () => [
  { type: 'command', name: 'node', ok: true, severity: 'error', status: '20.11.0', found: '20.11.0', range: '>=18', note: 'required >=18', hint: null },
  { type: 'command', name: 'docker', ok: false, severity: 'error', status: 'not found', found: null, range: '>=24', note: 'required >=24', hint: 'install docker' },
  { type: 'file', name: 'config/app.yml', ok: false, severity: 'warn', status: 'missing', found: null, range: null, note: '', hint: null },
  { type: 'env', name: 'DATABASE_URL', ok: false, severity: 'error', status: 'missing', found: null, range: null, note: 'declared in .env.example', hint: null },
];

test('summarize: counts pass/fail/warnings and readiness', () => {
  const s = summarize(mixed());
  assert.equal(s.total, 4);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 3);
  assert.equal(s.warnings, 1);
  assert.equal(s.errorFailures, 2);
  assert.equal(s.ready, false);
});

test('exitCodeFor: 1 when an error-severity check fails', () => {
  assert.equal(exitCodeFor(mixed()), 1);
});

test('exitCodeFor: 0 when all pass', () => {
  const results = [
    { type: 'command', name: 'node', ok: true, severity: 'error', status: '20.11.0', found: '20.11.0', range: '>=18', note: '', hint: null },
  ];
  assert.equal(exitCodeFor(results), 0);
});

test('exitCodeFor: 0 when only warnings fail', () => {
  const results = [
    { type: 'file', name: 'x', ok: false, severity: 'warn', status: 'missing', found: null, range: null, note: '', hint: null },
  ];
  assert.equal(exitCodeFor(results), 0);
});

test('formatHuman: renders symbols, labels, notes, hints and the summary', () => {
  const text = formatHuman(mixed());
  assert.match(text, /envcheck \u2014 environment report/);
  assert.match(text, /\u2713 node/);          // pass check
  assert.match(text, /\u2717 docker/);         // error fail
  assert.match(text, /\u26a0 config\/app\.yml/); // warn fail
  assert.match(text, /env DATABASE_URL/);       // env label prefix
  assert.match(text, /\(required >=18\)/);
  assert.match(text, /\u2192 install docker/);  // hint arrow
  assert.match(text, /3 problems found\. Environment is NOT ready\./);
});

test('formatHuman: all-pass summary', () => {
  const text = formatHuman([
    { type: 'command', name: 'node', ok: true, severity: 'error', status: '20.11.0', found: '20.11.0', range: '>=18', note: 'required >=18', hint: null },
  ]);
  assert.match(text, /All 1 check passed\. Environment is ready\./);
});

test('formatHuman: only-warnings summary', () => {
  const text = formatHuman([
    { type: 'file', name: 'x', ok: false, severity: 'warn', status: 'missing', found: null, range: null, note: '', hint: null },
  ]);
  assert.match(text, /1 warning\. Environment is usable/);
});

test('formatHuman: empty results explains there is nothing to check', () => {
  const text = formatHuman([]);
  assert.match(text, /no requirements found/);
  assert.match(text, /Nothing to check\./);
});

test('toJson: stable machine shape, and no env values leak', () => {
  const json = toJson(mixed(), { source: 'config' });
  assert.equal(json.ok, false);
  assert.equal(json.ready, false);
  assert.equal(json.source, 'config');
  assert.deepEqual(json.summary, { total: 4, passed: 1, failed: 3, warnings: 1, errors: 2 });
  assert.equal(json.checks.length, 4);
  assert.deepEqual(json.checks[0], {
    type: 'command', name: 'node', ok: true, severity: 'error', status: '20.11.0', found: '20.11.0', range: '>=18',
  });
  // env check exposes only name + status, never a value
  const envCheck = json.checks.find((c) => c.type === 'env');
  assert.equal(envCheck.found, null);
  assert.equal(envCheck.status, 'missing');
});
