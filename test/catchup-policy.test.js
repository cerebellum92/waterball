import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBoardPages, canonicalBoard, matchArticleWithRule } from '../shared/push-rules.js';
const row = id => `<div class="r-ent"><div class="title"><a href="/bbs/stock/${id}.html">test</a></div><div class="author">tester</div></div>`;
const page = (ids, previous) => `<div class="r-list-container">${ids.map(row).join('')}</div>${previous ? `<a href="/bbs/stock/index${previous}.html">&lsaquo; 上頁</a>` : ''}`;
const stats = () => ({ lastTopArticleId: 'M.boundary', overlapIds: ['M.boundary'] });
test('Catch-up stops at 100 across rounds, retains newest articles, and explicitly records an unresolved historical gap', async () => {
  let now = 1800000000000, requests = 0;
  const request = async url => {
    const n = url.endsWith('index.html') ? 100 : Number(url.match(/index(\d+)/)[1]); requests++;
    return { status: 'ok', text: page(Array.from({ length: 10 }, (_, i) => `M.page${n}.${i}`), n - 1) };
  };
  const first = await fetchBoardPages('stock', stats(), request, { clock: () => now });
  assert.equal(first.status, 'partial'); assert.equal(first.articles.length, 50);
  const start = first.continuation.startedAt, cutoff = first.continuation.cutoffAt;
  now += 180000;
  const second = await fetchBoardPages('stock', { ...stats(), backfill: structuredClone(first.continuation) }, request, { clock: () => now });
  assert.equal(second.status, 'complete'); assert.equal(second.boundaryFound, false);
  assert.equal(second.catchUp.reason, 'count'); assert.equal(second.catchUp.startedAt, start); assert.equal(second.catchUp.cutoffAt, cutoff);
  assert.equal(second.articles.length, 100); assert.equal(second.observedHead, 'M.page100.9'); assert.equal(second.continuation, null); assert.equal(requests, 10);
});
test('Time cutoff is fixed at scan start and does not affect already tracked candidates', async () => {
  const now = 1800000000000, recent = `M.${now / 1000 - 10}.A`, old = `M.${now / 1000 - 1801}.A`;
  const result = await fetchBoardPages('stock', stats(), async () => ({ status: 'ok', text: page([old, recent], 99) }), { clock: () => now });
  assert.equal(result.catchUp.reason, 'age'); assert.deepEqual(result.articles.map(a => a.id), [recent]); assert.equal(result.boundaryFound, false);
  // Article age only bounds discovery/backfill, not the separate candidate matching path.
  assert.equal(matchArticleWithRule({ id: old, board: 'stock', nrec: '55', title: 'x', author: 'tester' }, { board: 'stock', enabled: true, minPushes: 50, keywords: [] }, true), true);
});
test('An expired continuation terminates without downloading or sending its stale buffer', async () => {
  const now = 1800000000000;
  const result = await fetchBoardPages('stock', { ...stats(), backfill: { startedAt: now - 1800000, cutoffAt: now - 3600000, nextUrl: 'https://www.ptt.cc/bbs/stock/index99.html', articles: [{ id: 'M.old' }], observedHead: 'M.frozen' } }, () => { throw new Error('must not fetch'); }, { clock: () => now });
  assert.equal(result.catchUp.reason, 'deadline'); assert.deepEqual(result.articles, []); assert.equal(result.boundaryFound, false); assert.equal(result.observedHead, 'M.frozen');
});
test('A failed backfill preserves its fixed window and retry URL across a restart snapshot', async () => {
  let calls = 0;
  const first = await fetchBoardPages('stock', stats(), async () => ++calls === 1 ? { status: 'ok', text: page(['M.new'], 99) } : { status: 'blocked', dueAt: 1234 }, { clock: () => 10000000 });
  assert.equal(first.status, 'partial'); assert.equal(first.dueAt, 1234);
  let seenUrl;
  const second = await fetchBoardPages('stock', { ...stats(), backfill: structuredClone(first.continuation) }, async url => { seenUrl = url; return { status: 'ok', text: page(['M.boundary'], null) }; }, { clock: () => 10180000 });
  assert.ok(seenUrl.endsWith('index99.html')); assert.equal(second.boundaryFound, true); assert.equal(second.catchUp.startedAt, 10000000);
});
test('Moving live head cannot contaminate frozen backfill; a following bounded scan bridges the gap', async () => {
  let head = 100;
  const request = async url => {
    const n = url.endsWith('index.html') ? head : Number(url.match(/index(\d+)/)[1]);
    return { status: 'ok', text: page(n === 94 ? ['M.boundary', `M.page${n}`] : [`M.page${n}`], n - 1) };
  };
  const first = await fetchBoardPages('stock', stats(), request);
  head = 110;
  const second = await fetchBoardPages('stock', { ...stats(), backfill: first.continuation }, request);
  assert.equal(second.status, 'complete'); assert.equal(second.articles.some(a => a.id === 'M.page110'), false);
  let next = { lastTopArticleId: second.observedHead, overlapIds: second.articles.slice(-20).map(a => a.id) };
  const observed = new Set();
  for (let i = 0; i < 3; i++) {
    const r = await fetchBoardPages('stock', next, request);
    r.articles.forEach(a => observed.add(a.id));
    next = r.status === 'partial' ? { ...next, backfill: r.continuation } : { lastTopArticleId: r.observedHead, overlapIds: r.articles.slice(-20).map(a => a.id) };
  }
  assert.ok(observed.has('M.page105'));
});
test('Byte budget bounds pathological article titles without pretending to find a boundary', async () => {
  const result = await fetchBoardPages('stock', stats(), async () => ({ status: 'ok', text: page(['M.a', 'M.b'], 99).replaceAll('>test<', `>${'x'.repeat(2000)}<`) }), { maxBytes: 1024 });
  assert.equal(result.catchUp.reason, 'bytes'); assert.equal(result.boundaryFound, false); assert.ok(new TextEncoder().encode(JSON.stringify(result.articles)).length <= 1024);
});
test('Legacy continuation cannot restart an unbounded historical scan; removed Gossip alias stays removed', async () => {
  let url;
  const result = await fetchBoardPages('stock', { ...stats(), backfill: { articles: [], nextUrl: 'https://www.ptt.cc/bbs/stock/index1.html' } }, async value => { url = value; return { status: 'ok', text: page(['M.new'], null) }; });
  assert.ok(url.endsWith('index.html')); assert.equal(result.status, 'complete'); assert.equal(canonicalBoard('Gossip'), 'Gossip');
});
