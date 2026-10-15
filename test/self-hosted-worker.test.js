import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ArticleTracker } from '../cloudflare/self-hosted-worker.js';
import { ArticleMonitorManager } from '../src/article_monitor.js';
const secret = 'single_owner_secret_'.repeat(3);
const ownBot = '111:OWN_TEST_BOT_ABCDEFGHIJK';
const rule = (board = 'stock') => ({ id: board, board, enabled: true, keywords: [], author: '', minPushes: 0 });
const article = (id = 'M.new', nrec = '1') => ({ id, board: 'stock', title: 'own test', author: 'tester', nrec, link: `/bbs/stock/${id}.html` });
const row = a => `<div class="r-ent"><div class="nrec">${a.nrec}</div><div class="title"><a href="${a.link}">${a.title}</a></div><div class="author">${a.author}</div></div>`;
const page = articles => '<div class="r-list-container">' + articles.map(row).join('') + '</div>';
class TransactionStorage {
  constructor() { this.value = undefined; this.alarm = null; this.fail = false; this.tail = Promise.resolve(); }
  async get() { return structuredClone(this.value); }
  async deleteAll() { this.value = undefined; }
  async setAlarm(at) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
  transaction(fn) {
    const transaction = this.tail.then(async () => {
      let draft = structuredClone(this.value);
      const result = await fn({ get: async () => structuredClone(draft), put: async (_, value) => { if (this.fail) throw new Error('storage failure'); draft = structuredClone(value); } });
      this.value = draft; return result;
    });
    this.tail = transaction.catch(() => {}); return transaction;
  }
}
function fixture() {
  let now = 10000000000, response = url => new Response(url.includes('telegram.org') ? '{"ok":true}' : page([article('M.old')]));
  const calls = [], storage = new TransactionStorage(), env = { SYNC_SECRET: secret, BOT_TOKEN: ownBot, BACKEND_URL: 'https://official.example.must-never-be-used', MAX_BOARDS_PER_USER: '10' };
  const dependencies = { clock: () => now, sleep: async ms => { now += ms; }, random: () => 0, fetch: async (url, init) => { calls.push({ url, init, at: now }); return response(url, init); } };
  let object = new ArticleTracker({ storage }, env, dependencies);
  env.TRACKER = { idFromName: () => 'owner', get: () => object };
  const request = (path = '/sync', method = 'GET', body, token = secret) => worker.fetch(new Request(`https://private.example${path}`, { method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  const setup = () => request('/sync', 'POST', { rules: [rule()], telegram: { enabled: true, chatId: '888999', botToken: '', silent: false }, requestId: 'initial_setup', baseRevision: 0, lifecycleVersion: 0, action: 'resume' });
  return { env, storage, calls, request, setup, now: () => now, advance: ms => { now += ms; }, response: fn => { response = fn; }, object: () => object, restart: () => { object = new ArticleTracker({ storage }, env, dependencies); }, queue: async () => object.commit(s => { s.pending.push({ id: 'stock:M.new', article: article(), epoch: s.epoch, attempts: 0, createdAt: now, nextAttemptAt: now }); }) };
}
test('Independent Worker rejects missing/wrong secret and never exposes bot credentials', async () => {
  const f = fixture();
  assert.equal((await f.request('/sync', 'GET', undefined, 'wrong')).status, 401);
  assert.equal((await worker.fetch(new Request('https://private.example'), {})).status, 503);
  assert.equal((await f.setup()).status, 200);
  const config = await (await f.request()).text(); assert.equal(config.includes(ownBot), false); assert.equal(config.includes(secret), false);
  assert.equal((await f.request('/pair', 'POST', { pairingCode: 'WB2-anything' })).status, 400);
});
test('Self-hosted sync validates quota/types/body size and storage failure never ACKs', async () => {
  const f = fixture(); await f.setup();
  const before = await f.object().read();
  const payload = { rules: Array.from({ length: 11 }, (_, i) => rule(`b${i}`)), telegram: { enabled: true, chatId: '888999' }, baseRevision: 1, requestId: 'over_quota' };
  assert.equal((await f.request('/sync', 'POST', payload)).status, 400);
  assert.equal((await f.request('/sync', 'POST', { ...payload, rules: [{ ...rule(), minPushes: true }] })).status, 400);
  assert.equal((await f.request('/sync', 'POST', { value: '字'.repeat(200000) })).status, 413);
  f.storage.fail = true;
  assert.equal((await f.request('/sync', 'POST', { ...payload, rules: [rule()] })).status, 503);
  const after = await f.object().read(); assert.deepEqual(after.rules, before.rules); assert.equal(after.configRevision, before.configRevision);
});
test('Own Worker alarms establish baseline, queue new article, and only use own PTT/Telegram destinations', async () => {
  const f = fixture(); await f.setup(); await f.object().alarm();
  assert.equal((await f.object().read()).pending.length, 0);
  f.advance(180000); f.response(url => new Response(url.includes('telegram.org') ? '{"ok":true}' : page([article('M.old'), article('M.new')])));
  await f.object().alarm(); assert.equal((await f.object().read()).pending.length, 1);
  assert.ok(f.storage.alarm <= f.now() + 1000);
  f.advance(1000); await f.object().alarm();
  assert.ok((await f.object().read()).delivered['stock:M.new']);
  const telegram = f.calls.filter(c => c.url.includes('telegram.org'));
  assert.equal(telegram.length, 1); assert.ok(telegram[0].url.includes(`bot${ownBot}/`));
  assert.equal(JSON.parse(telegram[0].init.body).chat_id, '888999');
  assert.ok(f.calls.every(c => c.url.startsWith('https://www.ptt.cc/') || c.url.startsWith(`https://api.telegram.org/bot${ownBot}/`)));
});
test('Self-hosted 429 schedules from finish time, stops after five sends, TTL drops old work', async () => {
  const f = fixture(); await f.setup(); await f.queue();
  f.response(() => { f.advance(20000); return new Response('{"ok":false,"error_code":429,"parameters":{"retry_after":10}}', { status: 429 }); });
  await f.object().deliver(); assert.equal((await f.object().read()).pending[0].nextAttemptAt, f.now() + 10000);
  for (let i = 0; i < 6; i++) { f.advance(10000); await f.object().deliver(); }
  assert.equal(f.calls.length, 5); assert.equal((await f.object().read()).pending.length, 0);
  await f.queue(); await f.object().commit(s => { s.pending[0].createdAt -= 31 * 60000; });
  await f.object().deliver(); assert.equal(f.calls.length, 5);
});
test('Self-hosted pause cancels alarms/jobs; restart and resume retain 180s guard', async () => {
  const f = fixture(); await f.setup(); await f.object().alarm(); await f.queue();
  assert.equal((await f.request('/lifecycle', 'POST', { action: 'pause', requestId: 'pause_owner', lifecycleVersion: 1 })).status, 200);
  assert.equal(f.storage.alarm, null); assert.equal((await f.object().read()).pending.length, 0);
  f.restart();
  await f.request('/lifecycle', 'POST', { action: 'resume', requestId: 'resume_owner', lifecycleVersion: 2 });
  await f.object().alarm(); assert.equal(f.calls.length, 1);
  f.advance(180000); await f.object().alarm(); assert.equal(f.calls.length, 2);
});
test('Self-hosted idempotent lifecycle replay and stale configuration never resume a pause', async () => {
  const f = fixture(); await f.setup();
  const pause = { action: 'pause', requestId: 'pause_replay', lifecycleVersion: 1 };
  await f.request('/lifecycle', 'POST', pause); await f.request('/lifecycle', 'POST', pause);
  assert.equal((await f.object().read()).lifecycleVersion, 2);
  const result = await f.request('/sync', 'POST', { requestId: 'normal_sync', baseRevision: 1, rules: [rule()], telegram: { enabled: true, chatId: '888999', botToken: '' } });
  assert.equal(result.status, 200); assert.equal((await f.object().read()).status, 'paused');
  assert.equal((await f.request('/sync', 'POST', { requestId: 'stale_sync', baseRevision: 1, rules: [], telegram: { enabled: true, chatId: '888999' } })).status, 409);
});
test('App advanced mode can activate and pause its own Worker without official pairing', async () => {
  const f = fixture(), values = new Map();
  const manager = new ArticleMonitorManager({ getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) });
  manager.saveCloudSyncConfig({ enabled: true, autoSync: false, workerUrl: 'https://private.example', syncSecret: secret });
  manager.saveTelegramConfig({ enabled: true, botToken: ownBot, chatId: '888999' }, { sync: false });
  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => worker.fetch(new Request(url, init), f.env);
  try {
    const result = await manager.syncToCloud({ lifecycleAction: 'resume', userInitiated: true });
    assert.equal(result.success, true); assert.equal(result.mode, 'selfHosted');
    assert.equal(manager.cloudSyncConfig.serverMode, 'selfHosted');
    assert.equal((await manager.syncToCloud({ lifecycleAction: 'pause', userInitiated: true })).success, true);
    assert.equal((await f.object().read()).status, 'paused');
  } finally { globalThis.fetch = original; }
});
test('Self-hosted candidates detect later pushes after article leaves index and partial cursor remains intact', async () => {
  const f = fixture(); await f.setup();
  await f.object().commit(s => { s.rules[0].minPushes = 10; });
  await f.object().alarm();
  f.advance(180000); f.response(() => new Response(page([article('M.old'), article('M.new', '1')]))); await f.object().alarm();
  assert.ok((await f.object().read()).candidates['stock:M.new']);
  f.advance(180000);
  f.response(url => new Response(url.includes('M.new.html') ? '<div id="main-content">' + '<span class="hl push-tag">推 </span>'.repeat(15) + '</div>' : page([article('M.old'), article('M.other')])));
  await f.object().alarm(); assert.ok((await f.object().read()).pending.some(j => j.id === 'stock:M.new'));
  const cursor = (await f.object().read()).boards.stock.lastTopArticleId;
  await f.object().observe('stock', { status: 'partial', continuation: { nextUrl: 'https://www.ptt.cc/bbs/stock/index99.html', articles: [], observedHead: 'M.future' } }, (await f.object().read()).epoch);
  assert.equal((await f.object().read()).boards.stock.lastTopArticleId, cursor);
});
test('Self-hosted alarm parses real PTT &lsaquo; entity and backfills without deadlocking', async () => {
  const f = fixture(); await f.setup();
  await f.object().alarm();
  await f.object().commit(s => {
    s.boards.stock.lastTopArticleId = 'M.boundary';
    s.boards.stock.overlapIds = ['M.boundary'];
  });
  f.advance(180000);
  f.response(url => {
    if (url.endsWith('index.html')) {
      return new Response(`<div class="r-list-container">${row(article('M.new'))}</div><a class="btn wide" href="/bbs/stock/index99.html">&lsaquo; 上頁</a>`);
    }
    return new Response(`<div class="r-list-container">${row(article('M.boundary'))}</div><a class="btn wide" href="/bbs/stock/index98.html">&lsaquo; 上頁</a>`);
  });
  await f.object().alarm();
  const s = await f.object().read();
  assert.equal(s.boards.stock.backfill, null);
  assert.equal(s.boards.stock.lastTopArticleId, 'M.new');
  assert.ok(s.pending.some(j => j.id === 'stock:M.new'));
});

