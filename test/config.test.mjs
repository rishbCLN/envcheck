import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEnvExample,
  inferCommandsFromEngines,
  validateConfig,
  inferConfig,
  loadConfig,
  buildInitConfig,
} from '../src/config.mjs';

test('parseEnvExample: names only; ignores comments, blanks, values, export', () => {
  const text = [
    '# a comment',
    '',
    'DATABASE_URL=postgres://localhost/db',
    'export API_KEY=secret-value',
    'EMPTY=',
    'BARE',
    '  # indented comment',
    'DATABASE_URL=dupe', // duplicate name
  ].join('\n');
  assert.deepEqual(parseEnvExample(text), ['DATABASE_URL', 'API_KEY', 'EMPTY', 'BARE']);
});

test('parseEnvExample: never returns a value', () => {
  const names = parseEnvExample('SECRET=hunter2\n');
  assert.deepEqual(names, ['SECRET']);
  assert.ok(!names.join(',').includes('hunter2'));
});

test('inferCommandsFromEngines: maps engines to command checks', () => {
  const cmds = inferCommandsFromEngines({ node: '>=18', npm: '>=9' });
  assert.deepEqual(cmds, [
    { name: 'node', range: '>=18', severity: 'error', hint: null },
    { name: 'npm', range: '>=9', severity: 'error', hint: null },
  ]);
  assert.deepEqual(inferCommandsFromEngines(undefined), []);
});

test('validateConfig: a valid config normalizes cleanly', () => {
  const { config, errors } = validateConfig({
    commands: [{ name: 'node', range: '>=18' }, { name: 'docker', range: '>=24', severity: 'warn', hint: 'get docker' }],
    env: { required: ['API_KEY'], fromExample: '.env.example' },
    files: ['config/app.yml', { path: 'data', severity: 'warn' }],
  });
  assert.deepEqual(errors, []);
  assert.equal(config.commands.length, 2);
  assert.equal(config.commands[0].range, '>=18');
  assert.equal(config.commands[1].severity, 'warn');
  assert.deepEqual(config.env.vars, [{ name: 'API_KEY', source: 'required' }]);
  assert.equal(config.env.fromExample, '.env.example');
  assert.equal(config.files[0].path, 'config/app.yml');
  assert.equal(config.files[1].severity, 'warn');
});

test('validateConfig: lists offending keys for a malformed config', () => {
  const { errors } = validateConfig({
    commands: 'nope',
    bogus: true,
    env: { required: [123], sneaky: 1 },
    files: [{}],
  });
  assert.ok(errors.some((e) => /unknown key: "bogus"/.test(e)));
  assert.ok(errors.some((e) => /"commands" must be an array/.test(e)));
  assert.ok(errors.some((e) => /env\.required\[0\] must be a non-empty string/.test(e)));
  assert.ok(errors.some((e) => /unknown key: "env\.sneaky"/.test(e)));
  assert.ok(errors.some((e) => /files\[0\]\.path is required/.test(e)));
});

test('validateConfig: rejects a non-object root and unsafe command names', () => {
  assert.ok(validateConfig([]).errors.some((e) => /must be a JSON object/.test(e)));
  const { errors } = validateConfig({ commands: [{ name: 'rm -rf' }] });
  assert.ok(errors.some((e) => /invalid characters/.test(e)));
});

test('validateConfig: a missing command name is an error', () => {
  const { errors } = validateConfig({ commands: [{ range: '>=1' }] });
  assert.ok(errors.some((e) => /commands\[0\]\.name is required/.test(e)));
});

test('inferConfig: builds a config from package.json engines + .env.example', () => {
  const files = {
    '/proj/package.json': JSON.stringify({ engines: { node: '>=18', npm: '>=9' } }),
    '/proj/.env.example': 'DATABASE_URL=x\nAPI_KEY=y\n# note\n',
  };
  const readFileSync = (p) => {
    const key = String(p).replace(/\\/g, '/');
    if (key in files) return files[key];
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  const existsSync = (p) => String(p).replace(/\\/g, '/') in files;

  const { config, source } = inferConfig({ cwd: '/proj', readFileSync, existsSync });
  assert.equal(source, 'inferred');
  assert.deepEqual(config.commands.map((c) => c.name), ['node', 'npm']);
  assert.deepEqual(config.env.vars, [
    { name: 'DATABASE_URL', source: '.env.example' },
    { name: 'API_KEY', source: '.env.example' },
  ]);
  assert.equal(config.env.fromExample, '.env.example');
});

test('inferConfig: nothing to infer yields source "none"', () => {
  const { config, source } = inferConfig({
    cwd: '/empty',
    readFileSync: () => { throw new Error('nope'); },
    existsSync: () => false,
  });
  assert.equal(source, 'none');
  assert.equal(config.commands.length, 0);
  assert.equal(config.env.vars.length, 0);
});

test('loadConfig: reads and validates an explicit envcheck.json, merging fromExample', () => {
  const files = {
    '/proj/envcheck.json': JSON.stringify({
      commands: [{ name: 'node', range: '>=18' }],
      env: { required: ['EXPLICIT'], fromExample: '.env.example' },
    }),
    '/proj/.env.example': 'DATABASE_URL=x\nEXPLICIT=y\n',
  };
  const readFileSync = (p) => files[String(p).replace(/\\/g, '/')];
  const existsSync = (p) => String(p).replace(/\\/g, '/') in files;

  const loaded = loadConfig({ cwd: '/proj', readFileSync, existsSync });
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.source, 'config');
  const names = loaded.config.env.vars.map((v) => v.name);
  assert.deepEqual(names, ['EXPLICIT', 'DATABASE_URL']); // explicit first, example merged (deduped)
});

test('loadConfig: invalid JSON reports a config error', () => {
  const files = { '/proj/envcheck.json': '{ not json ' };
  const readFileSync = (p) => files[String(p).replace(/\\/g, '/')];
  const existsSync = (p) => String(p).replace(/\\/g, '/') in files;
  const loaded = loadConfig({ cwd: '/proj', readFileSync, existsSync });
  assert.equal(loaded.config, null);
  assert.ok(loaded.errors.some((e) => /not valid JSON/.test(e)));
});

test('loadConfig: falls back to inference when no config exists', () => {
  const files = { '/proj/package.json': JSON.stringify({ engines: { node: '>=18' } }) };
  const readFileSync = (p) => files[String(p).replace(/\\/g, '/')];
  const existsSync = (p) => String(p).replace(/\\/g, '/') in files;
  const loaded = loadConfig({ cwd: '/proj', readFileSync, existsSync });
  assert.equal(loaded.source, 'inferred');
  assert.deepEqual(loaded.config.commands.map((c) => c.name), ['node']);
});

test('loadConfig: an explicit but missing --config path is an error', () => {
  const loaded = loadConfig({
    cwd: '/proj',
    configPath: '/proj/nope.json',
    readFileSync: () => { throw new Error('nope'); },
    existsSync: () => false,
  });
  assert.equal(loaded.config, null);
  assert.ok(loaded.errors.some((e) => /not found/.test(e)));
});

test('buildInitConfig: falls back to a node>=18 template when nothing is inferred', () => {
  const cfg = buildInitConfig({
    cwd: '/empty',
    readFileSync: () => { throw new Error('nope'); },
    existsSync: () => false,
  });
  assert.deepEqual(cfg.commands, [{ name: 'node', range: '>=18' }]);
  assert.equal(cfg.env.fromExample, '.env.example');
  assert.deepEqual(cfg.files, []);
});
