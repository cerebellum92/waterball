// Optional native workerd verification. Install Miniflare separately; production has no dependency.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { Miniflare, convertV4MiniflareOptions } = await import(process.env.WATERBALL_MINIFLARE_MODULE ? pathToFileURL(process.env.WATERBALL_MINIFLARE_MODULE).href : 'miniflare');
const persistence = await fs.mkdtemp(path.join(os.tmpdir(), 'waterball-workerd-'));
const bundle = await fs.readFile(new URL('../cloudflare/dist/self-hosted-worker.js', import.meta.url), 'utf8');
const secret = 'local_native_runtime_secret_1234567890';
const ownBot = '111:LOCAL_NATIVE_FAKE_BOT_ONLY';
const calls = [];
let pttRequests = 0;
// Test-only endpoints are appended in memory, never to any release artifact.
const script = bundle + `
const originalFetch = ArticleTracker.prototype.fetch;
ArticleTracker.prototype.fetch = async function(request) {
  this.testClock ??= Date.now(); this.clock = () => this.testClock;
  this.sleep = async ms => { this.testClock += ms; };
  const pathname = new URL(request.url).pathname;
  if (pathname === '/__test/state') return new Response(JSON.stringify(await this.read()));
  if (pathname === '/__test/advance') { this.testClock += 180000; return new Response('{}'); }
  if (pathname === '/__test/alarm') { await this.alarm(); return new Response('{}'); }
  if (pathname === '/__test/deliver') { await this.deliver(); return new Response('{}'); }
  return originalFetch.call(this, request);
};`;
const options = { name: 'self-hosted-runtime-test', modules: true, script, compatibilityDate: '2026-10-13', bindings: { SYNC_SECRET: secret, BOT_TOKEN: ownBot }, durableObjects: { TRACKER: { className: 'ArticleTracker', useSQLite: true } }, durableObjectsPersist: persistence, outboundService: async request => {
  const url = new URL(request.url); calls.push(url.href);
  if (url.hostname === 'www.ptt.cc') {
    pttRequests++;
    const row = id => `<div class="r-ent"><div class="nrec">1</div><div class="title"><a href="/bbs/stock/${id}.html">test</a></div><div class="author">tester</div></div>`;
    return new Response('<div class="r-list-container">' + row('M.old') + (pttRequests > 1 ? row('M.new') : '') + '</div>');
  }
  assert.equal(url.hostname, 'api.telegram.org'); assert.ok(url.pathname.startsWith(`/bot${ownBot}/`));
  return new Response('{"ok":true}');
} };
let mf;
try {
  mf = new Miniflare(convertV4MiniflareOptions ? { ...convertV4MiniflareOptions(options), resourcePersistencePath: persistence } : options);
  const request = (pathname, method = 'GET', data) => mf.dispatchFetch(`https://private.example${pathname}`, { method, headers: { Authorization: `Bearer ${secret}` }, ...(data ? { body: JSON.stringify(data) } : {}) });
  assert.equal((await mf.dispatchFetch('https://private.example/sync')).status, 401);
  const setup = await request('/sync', 'POST', { rules: [{ id: 'stock', board: 'stock', keywords: [], author: '', minPushes: 0, enabled: true }], telegram: { chatId: '888999', botToken: '', enabled: true }, action: 'resume', requestId: 'native_initial', baseRevision: 0, lifecycleVersion: 0 });
  assert.equal(setup.status, 200, await setup.text());
  let state;
  for (let i = 0; i < 40; i++) { state = await (await request('/__test/state')).json(); if (state.boards.stock.initialized) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(state.boards.stock.initialized, true, `Native alarm failed: ${JSON.stringify({ board: state.boards.stock, outboundCount: calls.length })}`);
  await request('/__test/advance', 'POST'); await request('/__test/alarm', 'POST');
  state = await (await request('/__test/state')).json(); assert.equal(state.pending.length, 1);
  await request('/__test/deliver', 'POST');
  state = await (await request('/__test/state')).json(); assert.ok(state.delivered['stock:M.new']);
  const paused = await request('/lifecycle', 'POST', { action: 'pause', requestId: 'native_pause', lifecycleVersion: 1 });
  assert.equal(paused.status, 200);
  await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions ? { ...convertV4MiniflareOptions(options), resourcePersistencePath: persistence } : options);
  const config = await (await request('/sync')).json();
  assert.equal(config.config.status, 'paused'); assert.equal(config.config.configRevision, 1);
  assert.equal(JSON.stringify(config).includes(ownBot), false);
  assert.ok(calls.every(url => url.startsWith('https://www.ptt.cc/') || url.startsWith(`https://api.telegram.org/bot${ownBot}/`)));
  await mf.dispose(); mf = undefined;
  const forwarded = [];
  const proxyOptions = { name: 'official-proxy-runtime-test', modules: true, script: await fs.readFile(new URL('../cloudflare/dist/official-worker.js', import.meta.url), 'utf8'), compatibilityDate: '2026-10-13', bindings: { BACKEND_URL: 'https://fake-origin.example', PROXY_SHARED_SECRET: 'fake_origin_proxy_secret' }, outboundService: async request => {
    assert.equal(new URL(request.url).hostname, 'fake-origin.example');
    forwarded.push({ url: request.url, auth: request.headers.get('Authorization'), webhook: request.headers.get('X-Telegram-Bot-Api-Secret-Token') });
    if (request.url.endsWith('/test')) return new Response('{"success":false}', { status: 403 });
    if ((await request.text()).includes('redirect-test')) return new Response('', { status: 302, headers: { Location: 'https://must-not-be-followed.example' } });
    return new Response('{"success":true}');
  } };
  mf = new Miniflare(convertV4MiniflareOptions ? { ...convertV4MiniflareOptions(proxyOptions), resourcePersistencePath: persistence } : proxyOptions);
  assert.equal((await mf.dispatchFetch('https://proxy.example/test', { method: 'POST' })).status, 403);
  assert.equal(forwarded.at(-1).auth, null);
  assert.equal((await mf.dispatchFetch('https://proxy.example/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'fake_webhook_secret' }, body: '{}' })).status, 200);
  assert.equal(forwarded.at(-1).webhook, 'fake_webhook_secret');
  assert.equal((await mf.dispatchFetch('https://proxy.example/sync', { method: 'POST', headers: { Authorization: 'Bearer fake_device' }, body: '{}' })).status, 200);
  assert.equal(forwarded.at(-1).auth, 'Bearer fake_device');
  const before = forwarded.length;
  assert.equal((await mf.dispatchFetch('https://proxy.example/sync', { method: 'POST', body: '字'.repeat(200000) })).status, 413);
  assert.equal(forwarded.length, before);
  assert.equal((await mf.dispatchFetch('https://proxy.example/sync', { method: 'POST', body: 'redirect-test' })).status, 502);
  assert.equal(forwarded.length, before + 1);
  console.log('Native workerd PASS: independent self-hosted auth/SQLite/automatic alarm/delivery/restart, plus official proxy auth/webhook/body limits/redirect rejection. No real outbound network.');
} finally { if (mf) await mf.dispose(); await fs.rm(persistence, { recursive: true, force: true }); }
