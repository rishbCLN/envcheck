import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies, parseVersion, compareVersions } from '../src/semver.mjs';

test('parseVersion: parses full, partial, prefixed, and pre-release versions', () => {
  assert.deepEqual(parseVersion('20.11.0'), { major: 20, minor: 11, patch: 0 });
  assert.deepEqual(parseVersion('v20.11.0'), { major: 20, minor: 11, patch: 0 });
  assert.deepEqual(parseVersion('1.2'), { major: 1, minor: 2, patch: 0 });
  assert.deepEqual(parseVersion('7'), { major: 7, minor: 0, patch: 0 });
  assert.deepEqual(parseVersion('1.2.3-beta.1'), { major: 1, minor: 2, patch: 3 });
});

test('parseVersion: returns null for junk', () => {
  assert.equal(parseVersion('not-a-version'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
});

test('compareVersions: orders by major, minor, patch', () => {
  assert.equal(compareVersions(parseVersion('2.0.0'), parseVersion('1.9.9')), 1);
  assert.equal(compareVersions(parseVersion('1.2.3'), parseVersion('1.2.3')), 0);
  assert.equal(compareVersions(parseVersion('1.2.3'), parseVersion('1.2.4')), -1);
});

test('satisfies: >= operator (>=18 vs 20.11.0 is true)', () => {
  assert.equal(satisfies('20.11.0', '>=18'), true);
  assert.equal(satisfies('18.0.0', '>=18'), true);
  assert.equal(satisfies('16.20.0', '>=18'), false);
});

test('satisfies: other comparison operators', () => {
  assert.equal(satisfies('1.0.0', '<2'), true);
  assert.equal(satisfies('2.0.0', '<2'), false);
  assert.equal(satisfies('1.5.0', '>1.4'), true);
  assert.equal(satisfies('1.2.4', '<=1.2.4'), true);
  assert.equal(satisfies('1.2.5', '<=1.2.4'), false);
  assert.equal(satisfies('1.2.3', '=1.2.3'), true);
  assert.equal(satisfies('1.2.4', '=1.2.3'), false);
});

test('satisfies: caret ^1.2 accepts 1.9 but not 2.0', () => {
  assert.equal(satisfies('1.9.0', '^1.2'), true);
  assert.equal(satisfies('1.2.0', '^1.2'), true);
  assert.equal(satisfies('2.0.0', '^1.2'), false);
  assert.equal(satisfies('1.1.0', '^1.2'), false);
});

test('satisfies: caret with leading-zero majors narrows the range', () => {
  assert.equal(satisfies('0.2.9', '^0.2.3'), true);
  assert.equal(satisfies('0.3.0', '^0.2.3'), false);
  assert.equal(satisfies('0.0.3', '^0.0.3'), true);
  assert.equal(satisfies('0.0.4', '^0.0.3'), false);
});

test('satisfies: tilde ~1.2.3 allows patch bumps only', () => {
  assert.equal(satisfies('1.2.3', '~1.2.3'), true);
  assert.equal(satisfies('1.2.9', '~1.2.3'), true);
  assert.equal(satisfies('1.2.2', '~1.2.3'), false);
  assert.equal(satisfies('1.3.0', '~1.2.3'), false);
});

test('satisfies: tilde ~1.2 and ~1 widen appropriately', () => {
  assert.equal(satisfies('1.2.9', '~1.2'), true);
  assert.equal(satisfies('1.3.0', '~1.2'), false);
  assert.equal(satisfies('1.9.9', '~1'), true);
  assert.equal(satisfies('2.0.0', '~1'), false);
});

test('satisfies: x-ranges', () => {
  assert.equal(satisfies('1.2.9', '1.2.x'), true);
  assert.equal(satisfies('1.3.0', '1.2.x'), false);
  assert.equal(satisfies('1.9.0', '1.x'), true);
  assert.equal(satisfies('2.0.0', '1.x'), false);
  assert.equal(satisfies('20.11.0', '*'), true);
  assert.equal(satisfies('20.11.0', ''), true);
});

test('satisfies: plain versions behave like the specified precision', () => {
  assert.equal(satisfies('1.2.3', '1.2.3'), true);
  assert.equal(satisfies('1.2.4', '1.2.3'), false);
  assert.equal(satisfies('1.2.9', '1.2'), true);
  assert.equal(satisfies('1.3.0', '1.2'), false);
});

test('satisfies: || unions', () => {
  assert.equal(satisfies('18.0.0', '^16 || ^18'), true);
  assert.equal(satisfies('16.4.0', '^16 || ^18'), true);
  assert.equal(satisfies('17.0.0', '^16 || ^18'), false);
});

test('satisfies: compound AND ranges honor BOTH bounds (regression)', () => {
  // Previously the upper bound was silently dropped, so a too-new version
  // wrongly PASSED. Both bounds must now be enforced.
  assert.equal(satisfies('19.0.0', '>=18 <21'), true);
  assert.equal(satisfies('18.0.0', '>=18 <21'), true);
  assert.equal(satisfies('20.9.9', '>=18 <21'), true);
  assert.equal(satisfies('21.0.0', '>=18 <21'), false); // upper bound now enforced
  assert.equal(satisfies('25.0.0', '>=18 <21'), false); // too-new no longer passes
  assert.equal(satisfies('17.0.0', '>=18 <21'), false); // lower bound still enforced
  // full-precision compound
  assert.equal(satisfies('3.0.0', '>=1.0.0 <2.0.0'), false);
  assert.equal(satisfies('1.5.0', '>=1.0.0 <2.0.0'), true);
  // <= upper bound is inclusive
  assert.equal(satisfies('20.0.0', '>=18 <=20'), true);
  assert.equal(satisfies('21.0.0', '>=18 <=20'), false);
  // a compound alternative inside a || union
  assert.equal(satisfies('16.5.0', '>=14 <15 || >=16 <17'), true);
  assert.equal(satisfies('15.5.0', '>=14 <15 || >=16 <17'), false);
});

test('satisfies: operator detached from its version by spaces still parses', () => {
  assert.equal(satisfies('20.0.0', '>= 18'), true);
  assert.equal(satisfies('17.0.0', '>= 18'), false);
  assert.equal(satisfies('19.0.0', '>= 18 < 21'), true);
  assert.equal(satisfies('25.0.0', '>= 18 < 21'), false);
});

test('satisfies: junk never throws and is a non-match', () => {
  assert.equal(satisfies('not-a-version', '>=1.0.0'), false);
  assert.equal(satisfies('1.2.3', 'garbage'), false);
  assert.equal(satisfies('1.2.3', '1.x.3'), false);
  assert.equal(satisfies('', '>=1'), false);
  assert.equal(satisfies(null, '*'), false);
});
