/**
 * Regression tests for alias-aware mergeByIds/buildIdSet and reconcile matching.
 * Run: node packages/cli/scripts/test-reconcile-merge.mjs
 * Exits non-zero on first failure.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { mergeByIds, buildIdSet, getItemKeys } = require('../engine/collectors/_util.js');
const { matchItems, isSyntheticBlogId, isSyntheticBoardId, isSyntheticAlbumId, normTime } = require('../engine/reconcile.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exit(1); }
}

// ── detection ──
test('detection rules', () => {
  assert.equal(isSyntheticBlogId('35'), true);
  assert.equal(isSyntheticBlogId('1132406925'), false);
  assert.equal(isSyntheticBoardId('284'), true);
  assert.equal(isSyntheticBoardId('1000050065'), false);
  assert.equal(isSyntheticAlbumId('06bf9fe4-470b-438f-ac68-e0e024fb5bd0'), true);
  assert.equal(isSyntheticAlbumId('V109Elt62KKCmi'), false);
  assert.equal(isSyntheticAlbumId('82074430'), false);
});

// ── alias-aware merge: synthetic copy + reconciled real-id copy = ONE item ──
test('alias merge collapses synthetic + real-id copies', () => {
  const windows = [{ blogId: '35', title: 'A', comments: [{ x: 1 }] }];
  const mac = [{ blogId: '1132406925', blogid: '1132406925', legacyId: '35', title: 'A', readnum: 7 }];
  const { merged, addedCount, duplicateCount } = mergeByIds(windows, mac, 'blogs', { fieldMerge: true });
  assert.equal(merged.length, 1, 'should collapse to one');
  assert.equal(addedCount, 0);
  assert.equal(duplicateCount, 1);
  assert.equal(merged[0].blogId, '1132406925', 'real id wins');
  assert.equal(merged[0].readnum, 7, 'real-id copy enrichment kept');
  assert.equal(merged[0].comments.length, 1, 'windows comments backfilled');
});

// ── order independence: incoming synthetic vs base real ──
test('alias merge works regardless of side', () => {
  const base = [{ blogId: '1132406925', legacyId: '35', readnum: 7 }];
  const incoming = [{ blogId: '35', comments: [{ x: 1 }] }];
  const { merged } = mergeByIds(base, incoming, 'blogs', { fieldMerge: true });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].blogId, '1132406925', 'resolved real id retained');
  assert.equal(merged[0].comments.length, 1);
});

// ── backward compat: plain dedup without legacyId, base wins ──
test('plain dedup keeps base on id collision', () => {
  const base = [{ tid: 'aaa', v: 'base' }];
  const incoming = [{ tid: 'aaa', v: 'inc' }, { tid: 'bbb', v: 'new' }];
  const { merged, addedCount, duplicateCount } = mergeByIds(base, incoming, 'messages');
  assert.equal(merged.length, 2);
  assert.equal(addedCount, 1);
  assert.equal(duplicateCount, 1);
  assert.equal(merged.find((m) => m.tid === 'aaa').v, 'base');
});

// ── no-id items never dedupe (placeholder keys) ──
test('items without id are not deduped', () => {
  const base = [{ foo: 1 }];
  const incoming = [{ foo: 2 }, { foo: 3 }];
  const { merged } = mergeByIds(base, incoming, 'blogs');
  assert.equal(merged.length, 3);
});

// ── field merge prefers richer arrays ──
test('fieldMerge keeps the longer enrichment arrays', () => {
  const base = [{ id: '1000050065', legacyId: '5', likes: [1, 2, 3] }];
  const incoming = [{ id: '1000050065', likes: [1] }];
  const { merged } = mergeByIds(base, incoming, 'boards', { fieldMerge: true });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].likes.length, 3);
});

// ── buildIdSet includes legacyId so resumes recognise both ──
test('buildIdSet includes primary id and legacyId', () => {
  const set = buildIdSet([{ blogId: '1132406925', legacyId: '35' }], 'blogs');
  assert.ok(set.has('1132406925'));
  assert.ok(set.has('35'));
});

test('getItemKeys returns both keys', () => {
  const keys = getItemKeys('boards', { id: '1000050065', legacyId: '284' });
  assert.deepEqual(keys.sort(), ['1000050065', '284'].sort());
});

// ── matching ──
test('matchItems resolves unique, flags ambiguous and unmatched', () => {
  const synthetic = [
    { blogId: '35', title: 'Hello', pubTime: '2007-08-16 14:12' }, // unique -> resolved
    { blogId: '36', title: 'Dup', pubTime: '2010-01-01 00:00' },   // 2 candidates -> ambiguous
    { blogId: '37', title: 'Gone', pubTime: '2005-05-05 05:05' },  // none -> unmatched
  ];
  const live = [
    { blogId: '1111111111', title: 'Hello', pubtime: '2007-08-16 14:12' },
    { blogId: '2222222222', title: 'Dup', pubtime: '2010-01-01 00:00' },
    { blogId: '3333333333', title: 'Dup', pubtime: '2010-01-01 00:00' },
  ];
  const { resolved, ambiguous, unmatched } = matchItems(synthetic, live, 'blogs', (b) => b.blogId || b.blogid);
  assert.equal(resolved.get('35'), '1111111111');
  assert.equal(ambiguous, 1);
  assert.equal(unmatched, 1);
});

test('normTime normalises unix, iso, and string forms to minute', () => {
  assert.equal(normTime('2007-08-16 14:12:33'), '2007-08-16 14:12');
  assert.equal(normTime('2012-03-04T05:06:07.000Z').slice(0, 10), '2012-03-04');
  const unix = Math.floor(new Date('2020-01-02T03:04:00').getTime() / 1000);
  assert.equal(normTime(unix), '2020-01-02 03:04');
});

console.log(`\n${passed} tests passed.`);
