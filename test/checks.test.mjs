import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractVersion,
  isSafeCommandName,
  runCommandCheck,
  runEnvCheck,
  runFileCheck,
  runAllChecks,
} from '../src/checks.mjs';

test('extractVersion: pulls x.y.z out of real --version strings', () => {
  assert.equal(extractVersion('git version 2.44.0'), '2.44.0');
  assert.equal(extractVersion('Docker version 24.0.7, build afdd53b'), '24.0.7');
  assert.equal(extractVersion('v20.11.0'), '20.11.0');
  assert.equal(extractVersion('v20.11.0\n'), '20.11.0');
  assert.equal(extractVersion('10.2.4'), '10.2.4');
  assert.equal(extractVersion('Python 3.11.4'), '3.11.4');
  assert.equal(extractVersion('go version go1.22.0 linux/amd64'), '1.22.0');
});

test('extractVersion: null when there is no version', () => {
  assert.equal(extractVersion("'docker' is not recognized"), null);
  assert.equal(extractVersion(''), null);
  assert.equal(extractVersion(null), null);
});

test('isSafeCommandName: accepts real tool names, rejects injection attempts', () => {
  assert.equal(isSafeCommandName('node'), true);
  assert.equal(isSafeCommandName('docker-compose'), true);
  assert.equal(isSafeCommandName('python3.11'), true);
  assert.equal(isSafeCommandName('rm -rf /'), false);
  assert.equal(isSafeCommandName('node; echo hi'), false);
  assert.equal(isSafeCommandName('../bin/x'), false);
  assert.equal(isSafeCommandName(''), false);
  assert.equal(isSafeCommandName(42), false);
});

test('runCommandCheck: passing version satisfies the range', async () => {
  const run = async (cmd, args) => {
    assert.equal(cmd, 'node');
    assert.deepEqual(args, ['--version']);
    return { code: 0, stdout: 'v20.11.0\n', stderr: '' };
  };
  const r = await runCommandCheck({ name: 'node', range: '>=18' }, { run, shell: false });
  assert.equal(r.ok, true);
  assert.equal(r.found, '20.11.0');
  assert.equal(r.status, '20.11.0');
  assert.equal(r.severity, 'error');
  assert.equal(r.note, 'required >=18');
});

test('runCommandCheck: on a shell platform it probes via a single safe string', async () => {
  const seen = {};
  const run = async (cmd, args) => {
    seen.cmd = cmd;
    seen.args = args;
    return { code: 0, stdout: 'v20.11.0\n', stderr: '' };
  };
  const r = await runCommandCheck({ name: 'node', range: '>=18' }, { run, shell: true });
  assert.equal(seen.cmd, 'node --version'); // concatenated, not passed as args
  assert.deepEqual(seen.args, []);
  assert.equal(r.ok, true);
});

test('runCommandCheck: failing version is reported with its hint', async () => {
  const run = async () => ({ code: 0, stdout: 'v20.11.0\n', stderr: '' });
  const r = await runCommandCheck(
    { name: 'node', range: '>=22', hint: 'run nvm use 22' },
    { run },
  );
  assert.equal(r.ok, false);
  assert.equal(r.found, '20.11.0');
  assert.equal(r.hint, 'run nvm use 22');
});

test('runCommandCheck: a missing command (ENOENT) does not crash', async () => {
  const run = async () => ({
    code: -1,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
  });
  const r = await runCommandCheck({ name: 'docker', range: '>=24' }, { run });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'not found');
  assert.equal(r.found, null);
});

test('runCommandCheck: Windows "not recognized" is treated as not found', async () => {
  const run = async () => ({
    code: 1,
    stdout: '',
    stderr: "'docker' is not recognized as an internal or external command",
  });
  const r = await runCommandCheck({ name: 'docker', range: '>=24' }, { run });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'not found');
});

test('runCommandCheck: severity warn is preserved', async () => {
  const run = async () => ({
    code: -1,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
  });
  const r = await runCommandCheck({ name: 'docker', range: '*', severity: 'warn' }, { run });
  assert.equal(r.severity, 'warn');
  assert.equal(r.ok, false);
});

test('runCommandCheck: unsafe name is refused WITHOUT spawning', async () => {
  let called = false;
  const run = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
  const r = await runCommandCheck({ name: 'rm -rf /', range: '*' }, { run });
  assert.equal(called, false);
  assert.equal(r.ok, false);
  assert.equal(r.status, 'invalid name');
});

test('runEnvCheck: present and missing, and never exposes the value', () => {
  const present = runEnvCheck({ name: 'API_KEY', source: 'required' }, { env: { API_KEY: 'super-secret' } });
  assert.equal(present.ok, true);
  assert.equal(present.status, 'present');
  assert.equal(present.found, null);
  // secret-safety: the value must not leak into the serialized result
  assert.ok(!JSON.stringify(present).includes('super-secret'));

  const missing = runEnvCheck({ name: 'API_KEY', source: '.env.example' }, { env: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.note, 'declared in .env.example');
});

test('runEnvCheck: an empty value counts as missing', () => {
  const r = runEnvCheck('API_KEY', { env: { API_KEY: '' } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'missing');
});

test('runFileCheck: present and missing via injected existsSync', () => {
  const present = runFileCheck('config/app.yml', { existsSync: () => true });
  assert.equal(present.ok, true);
  assert.equal(present.status, 'present');

  const missing = runFileCheck(
    { path: 'config/app.yml', severity: 'warn', hint: 'copy the sample' },
    { existsSync: () => false },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.severity, 'warn');
  assert.equal(missing.hint, 'copy the sample');
});

test('runAllChecks: runs commands, files, then env in order', async () => {
  const config = {
    commands: [{ name: 'node', range: '>=18' }],
    files: [{ path: 'x.txt', severity: 'error', hint: null }],
    env: { vars: [{ name: 'API_KEY', source: 'required' }], fromExample: null },
  };
  const run = async () => ({ code: 0, stdout: 'v20.11.0', stderr: '' });
  const results = await runAllChecks(config, {
    run,
    existsSync: () => false,
    env: { API_KEY: 'set' },
  });
  assert.deepEqual(results.map((r) => r.type), ['command', 'file', 'env']);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[2].ok, true);
});
