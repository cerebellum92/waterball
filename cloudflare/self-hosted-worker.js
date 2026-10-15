import { notificationArticles, notificationMatches, coversArticle, notificationDue, reserveNotification, coalesceNotifications, digestPayload, revalidateNotification } from '../shared/notification-policy.js';
import { validateAndSanitizeRules, matchArticleWithRule, fetchBoardPages, canonicalBoard, cleanBotToken, positiveInteger, articleKey, pushCount, escapeHtml, MIN_BOARD_INTERVAL_MS, TIER_ROUNDS, httpError, isRecord } from '../shared/push-rules.js';
import { readBoundedBody, CORS_HEADERS } from '../shared/worker-http.js';

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function authenticated(request, env) {
  if (typeof env.SYNC_SECRET !== 'string' || env.SYNC_SECRET.length < 32) throw httpError(503, '請設定至少 32 字元的自架 SYNC_SECRET');
  const supplied = request.headers.get('Authorization') || '';
  const [a, b] = await Promise.all([env.SYNC_SECRET, supplied.replace(/^Bearer\s+/i, '')].map(value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  let diff = 0; const aa = new Uint8Array(a), bb = new Uint8Array(b);
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  if (!/^Bearer\s+/i.test(supplied) || diff) throw httpError(401, '自架同步密鑰不正確');
}
const initial = () => ({ schemaVersion: 1, rules: [], telegram: { chatId: '', botToken: '', enabled: false, silent: false }, status: 'paused', configRevision: 0, lifecycleVersion: 0, epoch: 1, boards: {}, cooldowns: {}, pending: [], candidates: {}, delivered: {}, receipts: {}, lastPttAt: 0, pttCoolingUntil: 0, telegramNextAt: 0, rate: { at: 0, count: 0 } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      await authenticated(request, env);
      if (!env.TRACKER) throw httpError(503, '請綁定獨立 TRACKER Durable Object');
      return await env.TRACKER.get(env.TRACKER.idFromName('single-owner')).fetch(request);
    } catch (e) { return json(e.statusCode || 503, { success: false, message: e.message }); }
  },
};

/** Strongly consistent storage + alarms, rather than eventually consistent KV locks. */
export class ArticleTracker {
  constructor(ctx, env, dependencies = {}) {
    this.ctx = ctx; this.env = env;
    this.clock = dependencies.clock || Date.now;
    this.fetchHttp = dependencies.fetch || ((...args) => fetch(...args));
    this.sleep = dependencies.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.random = dependencies.random || Math.random;
    this.timeoutMs = dependencies.timeoutMs || 15000;
    this.telegramTail = Promise.resolve();
    this.maxBoards = positiveInteger(env.MAX_BOARDS_PER_USER, 10, 1, 50);
    this.busy = false;
    this.catchUp = { clock: () => this.clock(),
      maxArticles: positiveInteger(env.CATCHUP_MAX_ARTICLES, 100, 1, 1000),
      maxAgeMs: positiveInteger(env.CATCHUP_MAX_AGE_MINUTES, 30, 1, 1440) * 60000,
    };
  }
  async read() { return await this.ctx.storage.get('state') || initial(); }
  async commit(fn) {
    return this.ctx.storage.transaction(async tx => {
      const draft = structuredClone(await tx.get('state') || initial());
      const result = fn(draft);
      if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > 1536 * 1024) throw httpError(503, '自架儲存容量已滿，請減少規則');
      await tx.put('state', draft); return result;
    });
  }
  config(s) { return { rules: s.rules, telegram: { chatId: s.telegram.chatId, enabled: s.status === 'active', silent: s.telegram.silent }, configRevision: s.configRevision, lifecycleVersion: s.lifecycleVersion, status: s.status, mode: 'selfHosted', leaseExpiresAt: null, pendingCount: s.pending.length, monitoring: Object.entries(s.boards).map(([board, b]) => ({ board, nextCheckAt: b.nextDueAt, lastError: b.lastError || null, backfilling: Boolean(b.backfill), catchUp: b.lastCatchUp || null })) }; }
  async arm() {
    const s = await this.read();
    if (s.status !== 'active' || !s.rules.some(r => r.enabled)) { await this.ctx.storage.deleteAlarm(); return; }
    const due = [...Object.values(s.boards).map(b => b.nextDueAt), ...s.pending.map(j => j.nextAttemptAt)];
    await this.ctx.storage.setAlarm(Math.max(this.clock() + 1000, Math.min(...due, this.clock() + 180000)));
  }
  async fetch(request) {
    try {
      await authenticated(request, this.env);
      await this.commit(s => {
        if (this.clock() - s.rate.at >= 60000) s.rate = { at: this.clock(), count: 0 };
        if (++s.rate.count > 60) throw httpError(429, 'Too many requests');
      });
      const pathname = new URL(request.url).pathname;
      if (request.method === 'GET' && ['/', '/status', '/sync', '/v2/me'].includes(pathname)) return json(200, { success: true, mode: 'selfHosted', config: this.config(await this.read()) });
      if (request.method === 'DELETE' && pathname === '/account') { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); return json(200, { success: true }); }
      if (request.method !== 'POST') throw httpError(404, 'Not Found');
      const raw = await readBoundedBody(request);
      let data; try { data = JSON.parse(raw ? new TextDecoder().decode(raw) : '{}'); } catch { throw httpError(400, 'Invalid JSON'); }
      if (!isRecord(data)) throw httpError(400, 'payload 必須為物件');
      if (pathname === '/pair') throw httpError(400, '自架服務不使用官方 WB2 配對碼，請填入您自己的 SYNC_SECRET');
      if (pathname === '/notification-test') {
        const s = await this.read();
        const response = await this.send('✅ Waterball 自架推播測試', s.epoch, true);
        return json(200, { success: response.ok, message: response.ok ? '測試訊息已送達' : response.error });
      }
      if (!['/sync', '/lifecycle'].includes(pathname)) throw httpError(404, 'Not Found');
      if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(data.requestId)) throw httpError(400, 'requestId 格式不正確');
      const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data))))].map(b => b.toString(16).padStart(2, '0')).join('');
      const result = await this.commit(s => {
        const receipt = Object.hasOwn(s.receipts, data.requestId) ? s.receipts[data.requestId] : null;
        if (receipt) { if (receipt.fingerprint !== fingerprint || receipt.response.configRevision !== s.configRevision || receipt.response.lifecycleVersion !== s.lifecycleVersion) throw httpError(409, '此操作已被後續變更取代'); return receipt.response; }
        if (pathname === '/sync') {
          if (data.baseRevision !== s.configRevision) throw httpError(409, '設定版本衝突');
          const validation = validateAndSanitizeRules(data.rules);
          if (!validation.valid) throw httpError(400, validation.message);
          if (new Set(validation.rules.filter(r => r.enabled).map(r => r.board.toLowerCase())).size > this.maxBoards) throw httpError(400, `最多 ${this.maxBoards} 板`);
          const t = data.telegram;
          if (!isRecord(t) || typeof t.enabled !== 'boolean' || typeof t.chatId !== 'string' || !/^-?\d+$/.test(t.chatId) || (t.silent !== undefined && typeof t.silent !== 'boolean') || (t.botToken !== undefined && typeof t.botToken !== 'string')) throw httpError(400, '自架 Telegram 設定格式不正確');
          const botToken = cleanBotToken(t.botToken || this.env.BOT_TOKEN);
          if (!/^\d+:[A-Za-z0-9_-]{10,}$/.test(botToken)) throw httpError(400, '請設定您的個人 Bot Token');
          if (s.telegram.chatId && s.telegram.chatId !== t.chatId) { s.epoch++; s.boards = {}; s.pending = []; s.candidates = {}; s.delivered = {}; }
          s.rules = validation.rules; s.configRevision++;
          s.telegram = { chatId: t.chatId, botToken, silent: t.silent === true, enabled: s.status === 'active' };
          const boards = new Set(s.rules.filter(r => r.enabled).map(r => r.board.toLowerCase()));
          for (const b of Object.keys(s.boards)) if (!boards.has(b)) delete s.boards[b];
          for (const b of boards) s.boards[b] ||= { initialized: false, tier: 1, quietStreak: 0, nextDueAt: this.clock(), seen: [], observed: {} };
        }
        if (data.action) {
          if (!['activate', 'resume', 'pause', 'renew'].includes(data.action)) throw httpError(400, '未知操作');
          if (data.lifecycleVersion !== s.lifecycleVersion) throw httpError(409, '推播狀態版本衝突');
          if (data.action !== 'renew') {
            s.status = data.action === 'pause' ? 'paused' : 'active'; s.telegram.enabled = s.status === 'active';
            s.epoch++; s.pending = []; s.candidates = {};
            for (const b of Object.values(s.boards)) { b.initialized = false; b.fanout = null; b.backfill = null; b.lastTopArticleId = null; b.overlapIds = []; b.seen = []; b.observed = {}; b.nextDueAt = this.clock(); }
          }
          s.lifecycleVersion++;
        } else if (pathname === '/lifecycle') throw httpError(400, '需要 action');
        s.pending = s.pending.flatMap(j => {
          const valid = j.epoch === s.epoch ? revalidateNotification(j, s.rules) : null;
          return valid ? [valid] : [];
        });
        for (const [key, candidate] of Object.entries(s.candidates)) if (!s.rules.some(r => r.minPushes > 0 && matchArticleWithRule(candidate.article, { ...r, minPushes: 0 }, true))) delete s.candidates[key];
        const response = { success: true, mode: 'selfHosted', status: s.status, configRevision: s.configRevision, lifecycleVersion: s.lifecycleVersion, leaseExpiresAt: null, rule_count: s.rules.length, updated_at: this.clock() };
        s.receipts[data.requestId] = { fingerprint, response };
        for (const key of Object.keys(s.receipts).slice(0, Math.max(0, Object.keys(s.receipts).length - 32))) delete s.receipts[key];
        return response;
      });
      await this.arm(); return json(200, result);
    } catch (e) { return json(e.statusCode || e.status || 503, { success: false, message: e.statusCode || e.status ? e.message : '自架儲存或網路異常，未確認成功' }); }
  }
  async http(url, init = {}) {
    const controller = new AbortController(); let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('HTTP deadline exceeded')); }, this.timeoutMs); });
    try {
      return await Promise.race([(async () => {
        const response = await this.fetchHttp(url, { ...init, signal: controller.signal, redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) throw new Error('HTTP redirects are not allowed');
        const bytes = await readBoundedBody(response, 2 * 1024 * 1024);
        return { status: response.status, ok: response.ok, text: bytes ? new TextDecoder().decode(bytes) : '' };
      })(), deadline]);
    } finally { clearTimeout(timer); }
  }
  async requestPtt(url, { board, kind }) {
    let s = await this.read();
    const wait = s.lastPttAt + 1200 + Math.floor(this.random() * 1001) - this.clock();
    if (wait > 0) await this.sleep(wait);
    s = await this.read();
    if (s.status !== 'active' || !s.rules.some(r => r.enabled && r.board.toLowerCase() === board)) return { status: 'cancelled' };
    if (s.pttCoolingUntil > this.clock()) return { status: 'deferred', dueAt: s.pttCoolingUntil };
    if (kind === 'index' && s.cooldowns[board] && this.clock() - s.cooldowns[board] < MIN_BOARD_INTERVAL_MS) return { status: 'deferred', dueAt: s.cooldowns[board] + MIN_BOARD_INTERVAL_MS };
    await this.commit(d => { d.lastPttAt = this.clock(); if (kind === 'index') d.cooldowns[board] = this.clock(); });
    const result = await this.http(url, { headers: { Cookie: 'over18=1', 'User-Agent': 'Waterball-Self-Hosted-Monitor/3.0' } });
    const hasPttContent = /class=["'](?:r-ent|r-list-container)["']|id="main-content"/.test(result.text);
    const isChallenge = !hasPttContent && ([403, 429].includes(result.status) || /cf-chl-|Just a moment|<form id="challenge-form"/i.test(result.text));
    if (isChallenge) {
      await this.commit(d => { d.pttCoolingUntil = this.clock() + 15 * 60000; });
      return { status: 'blocked', dueAt: this.clock() + 15 * 60000 };
    }
    if (!result.ok) throw new Error(`PTT HTTP ${result.status}`);
    return { status: 'ok', text: result.text };
  }
  async observe(board, result, epoch) {
    await this.commit(s => {
      const b = s.boards[board]; if (!b || s.status !== 'active' || epoch !== s.epoch) return;
      if (result.status === 'partial') { b.backfill = result.continuation; b.nextDueAt = this.clock() + 180000; return; }
      if (result.status !== 'complete') { b.lastError = result.status === 'blocked' ? 'PTT 暫時拒絕抓取，全站冷卻中' : null; b.nextDueAt = result.dueAt || this.clock() + 180000; return; }
      const seen = new Set(b.seen);
      const progress = b.fanout || { result: { ...result, articles: [...new Map(result.articles.map(a => [a.id, a])).values()] }, index: 0, first: !b.initialized, newIds: result.articles.filter(a => b.initialized && !seen.has(a.id)).map(a => a.id), newCount: 0, growth: false, createdAt: this.clock(), observedIndex: -1 };
      const newIds = new Set(progress.newIds);
      for (; progress.index < progress.result.articles.length; progress.index++) {
        const a = progress.result.articles[progress.index], key = articleKey(a), isNew = newIds.has(a.id), candidate = s.candidates[key];
        if (progress.observedIndex !== progress.index) {
          if (isNew) progress.newCount++;
          const previous = b.observed[a.id] ?? candidate?.article.nrec;
          if (previous !== undefined && pushCount(a) > pushCount({ nrec: String(previous) })) progress.growth = true;
          b.observed[a.id] = pushCount(a); progress.observedIndex = progress.index;
        }
        if (!progress.first && !s.delivered[key] && (isNew || candidate) && this.clock() - progress.createdAt < 1800000) {
          if (s.rules.some(r => matchArticleWithRule(a, r, isNew || Boolean(candidate)))) {
            if (!s.pending.some(j => coversArticle(j, a))) {
              if (s.pending.length >= 500) { b.fanout = progress; b.nextDueAt = this.clock() + 1000; return; }
              s.pending.push({ id: key, article: a, epoch: s.epoch, attempts: 0, createdAt: progress.createdAt, nextAttemptAt: this.clock(), catchUpLimited: Boolean(result.catchUp?.truncated) });
            }
            delete s.candidates[key];
          } else if (s.rules.some(r => r.minPushes > 0 && matchArticleWithRule(a, { ...r, minPushes: 0 }, true))) {
            if (!candidate && Object.keys(s.candidates).length >= 100) { const oldest = Object.entries(s.candidates).sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0][0]; delete s.candidates[oldest]; s.candidateEvictions = (s.candidateEvictions || 0) + 1; }
            s.candidates[key] = { article: a, expiresAt: candidate?.expiresAt || this.clock() + 86400000 };
          }
        }
        seen.add(a.id);
      }
      for (const a of progress.result.articles) seen.add(a.id);
      b.initialized = true; b.seen = [...seen].slice(-300); b.backfill = null; b.fanout = null;
      b.lastError = null;
      b.lastCheckTime = this.clock();
      if (progress.result.catchUp) b.lastCatchUp = progress.result.catchUp;
      b.lastTopArticleId = progress.result.observedHead; b.overlapIds = progress.result.articles.slice(-20).map(a => a.id);
      for (const key of Object.keys(b.observed).slice(0, Math.max(0, Object.keys(b.observed).length - 300))) delete b.observed[key];
      if (progress.first || progress.newCount || progress.growth) { b.tier = 1; b.quietStreak = 0; }
      else if (++b.quietStreak >= 3) { b.tier = Math.min(4, b.tier + 1); b.quietStreak = 0; }
      if (Object.values(s.candidates).some(c => c.article.board.toLowerCase() === board)) b.tier = Math.min(2, b.tier);
      b.nextDueAt = this.clock() + TIER_ROUNDS[b.tier] * 180000;
    });
  }
  send(text, epoch, test = false, job = null, extra = {}) {
    const task = this.telegramTail.then(() => this.sendNow(text, epoch, test, job, extra));
    this.telegramTail = task.catch(() => {}); return task;
  }
  async sendNow(text, epoch, test = false, job = null, extra = {}) {
    let s = await this.read();
    if (s.telegramNextAt - this.clock() > 2000) return { ok: false, throttled: true, retryAfter: Math.ceil((s.telegramNextAt - this.clock()) / 1000) };
    if (s.telegramNextAt > this.clock()) await this.sleep(s.telegramNextAt - this.clock());
    s = await this.read();
    if (!test && (s.status !== 'active' || s.epoch !== epoch)) return { ok: false, cancelled: true };
    if (job && (!s.pending.some(j => j.id === job.id) || !notificationMatches(job, s.rules))) return { ok: false, cancelled: true };
    if (!s.telegram.chatId || !s.telegram.botToken) return { ok: false, permanent: true, error: '尚未設定個人 Bot Token／Chat ID' };
    if (job) {
      const due = notificationDue(s.notificationStarts, this.clock());
      if (due > this.clock()) return { ok: false, throttled: true, retryAfter: Math.ceil((due - this.clock()) / 1000) };
    }
    await this.commit(d => {
      d.telegramNextAt = this.clock() + 1100;
      if (job) { reserveNotification(d, this.clock()); d.pending.find(j => j.id === job.id).sealed = true; }
    });
    const result = await this.http(`https://api.telegram.org/bot${s.telegram.botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: s.telegram.chatId, text, parse_mode: 'HTML', disable_notification: s.telegram.silent, disable_web_page_preview: true, link_preview_options: { is_disabled: true }, ...extra }) });
    let data; try { data = JSON.parse(result.text); } catch { data = {}; }
    if (result.ok && data.ok === true) return { ok: true };
    const status = data.error_code || result.status;
    if (status === 429) { const retryAfter = Number.isFinite(data.parameters?.retry_after) && data.parameters.retry_after > 0 ? Math.min(86400, data.parameters.retry_after) : 5; await this.commit(d => { d.telegramNextAt = this.clock() + retryAfter * 1000; }); return { ok: false, retryAfter }; }
    return { ok: false, permanent: [400, 401, 403, 404].includes(status), blocked: status === 403, error: data.description || `Telegram HTTP ${status}` };
  }
  validNotification(s, job) {
    return s.status === 'active' && job.epoch === s.epoch && job.attempts < 5 && this.clock() - job.createdAt < 1800000 && notificationMatches(job, s.rules);
  }
  async deliver() {
    await this.commit(s => { s.pending = coalesceNotifications(s.pending, this.clock(), () => s, j => this.validNotification(s, j)); });
    const ids = (await this.read()).pending.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt).slice(0, 5).map(j => j.id);
    for (const id of ids) {
      const s = await this.read(), job = s.pending.find(j => j.id === id);
      if (!job || job.nextAttemptAt > this.clock()) continue;
      const valid = this.validNotification(s, job);
      if (!valid) { await this.commit(d => { d.pending = d.pending.filter(j => j.id !== id); }); continue; }
      const due = notificationDue(s.notificationStarts, this.clock());
      if (due > this.clock()) { await this.commit(d => { const current = d.pending.find(j => j.id === id); current.nextAttemptAt = due; current.forceDigest = true; }); continue; }
      await this.commit(d => { const current = d.pending.find(j => j.id === id); current.attempts++; current.nextAttemptAt = this.clock() + this.timeoutMs + 30000; });
      const a = job.article;
      const link = `https://www.ptt.cc/bbs/${encodeURIComponent(a.board)}/${encodeURIComponent(a.id)}.html`;
      const nrec = a.nrec ? (a.nrec === '爆' ? '爆' : `${a.nrec}推`) : '0推';
      let msg = `🚨 <b>【Waterball 新文章推播】</b>\n📌 <b>看板</b>：#${escapeHtml(a.board)}\n📝 <b>標題</b>：${escapeHtml(a.title)}\n👤 <b>作者</b>：${escapeHtml(a.author)}\n🔥 <b>推文</b>：${escapeHtml(nrec)}`;
      if (job.digest) msg = digestPayload(job, s.telegram.chatId, s.telegram.silent).text;
      let response;
      try { response = await this.send(msg, job.epoch, false, job, job.digest ? {} : { reply_markup: { inline_keyboard: [[{ text: '📖 開啟 PTT', url: link }]] } }); }
      catch (e) { response = { ok: false, error: e.message }; }
      await this.commit(d => {
        const current = d.pending.find(j => j.id === id); if (!current) return;
        if (response.throttled) current.attempts--;
        if (response.ok) {
          for (const a of notificationArticles(job)) d.delivered[articleKey(a)] = this.clock();
          d.lastDelivery = { at: this.clock(), presentation: job.digest ? 'digest' : 'article', articleCount: notificationArticles(job).length };
        }
        if (response.blocked) { d.status = 'paused'; d.telegram.enabled = false; d.epoch++; d.lifecycleVersion++; d.pending = []; }
        else if (response.ok || response.cancelled || response.permanent || current.attempts >= 5) d.pending = d.pending.filter(j => j.id !== id);
        else current.nextAttemptAt = this.clock() + (response.retryAfter ? response.retryAfter * 1000 : Math.min(300000, 30000 * 2 ** (current.attempts - 1)));
      });
    }
  }
  async alarm() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.commit(s => {
        for (const b of Object.values(s.boards)) if ((b.backfill && !Number.isFinite(b.backfill.startedAt)) || (b.fanout && !b.fanout.result?.catchUp)) {
          b.backfill = null; b.fanout = null; b.nextDueAt = this.clock();
          b.lastCatchUp = { truncated: true, reason: 'legacy-reset', at: this.clock() };
        }
        for (const [key, c] of Object.entries(s.candidates)) if (c.expiresAt <= this.clock()) delete s.candidates[key];
        for (const [key, at] of Object.entries(s.delivered)) if (this.clock() - at > 2 * 86400000) delete s.delivered[key];
        for (const [board, at] of Object.entries(s.cooldowns)) if (!s.boards[board] && this.clock() - at >= 180000) delete s.cooldowns[board];
        s.pending = s.pending.filter(j => j.epoch === s.epoch && this.clock() - j.createdAt < 1800000 && j.attempts < 5);
      });
      await this.deliver();
      const s = await this.read();
      if (s.status !== 'active') return;
      const due = Object.entries(s.boards).filter(([, b]) => b.nextDueAt <= this.clock()).sort((a, b) => a[1].nextDueAt - b[1].nextDueAt)[0];
      if (due) {
        const [board, stats] = due;
        try {
          const rawName = s.rules.find(r => r.enabled && r.board.toLowerCase() === board)?.board || board;
          const name = canonicalBoard(rawName);
          const result = stats.fanout?.result || await fetchBoardPages(name, stats, (url, task) => this.requestPtt(url, { ...task, board }), this.catchUp);
          if (result.status === 'complete' && !stats.fanout) {
            const current = await this.read();
            const candidates = Object.values(current.candidates).filter(c => c.article.board.toLowerCase() === board).sort((a, b) => (a.lastCheckedAt || 0) - (b.lastCheckedAt || 0)).slice(0, 2);
            for (const c of candidates) {
              const detail = await this.requestPtt(`https://www.ptt.cc/bbs/${c.article.board}/${c.article.id}.html`, { board, kind: 'candidate' });
              if (detail.status !== 'ok') break;
              if (!/id="main-content"/.test(detail.text)) continue;
              const count = [...detail.text.matchAll(/class="[^"]*\bpush-tag\b[^"]*">\s*([^<]*)<\/span>/g)].reduce((sum, tag) => sum + (tag[1].trim() === '推' ? 1 : tag[1].trim() === '噓' ? -1 : 0), 0);
              result.articles.push({ ...c.article, nrec: count >= 100 ? '爆' : String(count) });
              await this.commit(d => { if (d.candidates[articleKey(c.article)]) d.candidates[articleKey(c.article)].lastCheckedAt = this.clock(); });
            }
          }
          await this.observe(board, result, s.epoch);
        }
        catch (e) { await this.commit(d => { if (d.boards[board]) { d.boards[board].lastError = e.message; d.boards[board].nextDueAt = this.clock() + 180000; } }); }
      }
    } finally { this.busy = false; await this.arm(); }
  }
}
