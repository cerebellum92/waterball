export const DAY = 86_400_000;
export const MIN_BOARD_INTERVAL_MS = 180_000;
export const TIER_ROUNDS = { 1: 1, 2: 2, 3: 5, 4: 10 };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
export const cleanBearerToken = value => String(value || '').replace(/^Bearer\s+/i, '').trim();
export function cleanBotToken(value) {
  return String(value || '').trim().replace(/^.*\/bot/, '').replace(/\/sendMessage.*$/, '').replace(/^bot(?=\d)/i, '').replace(/^\/+|\/+$/g, '');
}
export function httpError(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
export function positiveInteger(value, fallback, min = 1, max = 100000) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid numeric configuration: ${value}`);
  return n;
}
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const articleKey = a => `${a.board.toLowerCase()}:${a.id}`;
export const pushCount = a => a.nrec === '爆' ? 100 : a.nrec === 'XX' ? -100 : parseInt(a.nrec, 10) || 0;
export function getBoardPhaseOffset(board) {
  let hash = 0;
  for (const c of board) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash;
}
export function canonicalBoard(name) {
  return String(name || '').trim();
}
export function validateAndSanitizeRules(rawRules) {
  if (!Array.isArray(rawRules) || rawRules.length > 100) return { valid: false, message: 'rules 必須為陣列，雲端生效規則最多 100 條' };
  const rules = [], ids = new Set();
  for (const r of rawRules) {
    if (!isRecord(r) || typeof r.board !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(r.board.trim()) || ['__proto__', 'constructor', 'prototype'].includes(r.board.trim().toLowerCase())) return { valid: false, message: '看板名稱格式不合法' };
    if (typeof r.enabled !== 'boolean' || typeof r.minPushes !== 'number' || !Number.isInteger(r.minPushes) || r.minPushes < 0 || r.minPushes > 100) return { valid: false, message: 'enabled 必須為布林值；minPushes 必須為 0 至 100 整數' };
    if (typeof r.id !== 'string' || !r.id.trim() || r.id.length > 64 || ids.has(r.id.trim())) return { valid: false, message: '規則 id 必須為唯一字串（1 至 64 字元）' };
    if (r.author !== undefined && (typeof r.author !== 'string' || r.author.length > 32)) return { valid: false, message: 'author 必須為字串（最多 32 字元）' };
    if (r.keywords !== undefined && (!Array.isArray(r.keywords) || r.keywords.length > 20 || r.keywords.some(k => typeof k !== 'string' || k.length > 100))) return { valid: false, message: 'keywords 必須為字串陣列（最多 20 個、每個最多 100 字元）' };
    ids.add(r.id.trim());
    rules.push({ id: r.id.trim(), board: canonicalBoard(r.board), enabled: r.enabled, minPushes: r.minPushes, author: (r.author || '').trim(), keywords: (r.keywords || []).map(k => k.trim()).filter(Boolean) });
  }
  return { valid: true, rules };
}
export function isDeletedArticleTitle(title) {
  if (!title || typeof title !== 'string') return true;
  const clean = title.trim();
  if (!clean || clean === '-' || clean === '批踢踢實業坊') return true;
  if (/^[\(\[<]?(?:本文|此[篇文])?(?:已[經被]|已被|已被板主|已被版主).*刪除/i.test(clean)) return true;
  if (clean.includes('本文已被刪除') || clean.includes('本文已經被刪除') || clean.includes('本文已被版主刪除') || clean.includes('本文已被板主刪除')) return true;
  return false;
}
export function matchArticleWithRule(article, rule, isNewArticle = true) {
  if (!rule.enabled || article.board.toLowerCase() !== rule.board.toLowerCase()) return false;
  if (isDeletedArticleTitle(article.title)) return false;
  if (rule.author && article.author.toLowerCase() !== rule.author.toLowerCase()) return false;
  if (rule.minPushes > 0 ? pushCount(article) < rule.minPushes : !isNewArticle) return false;
  return !rule.keywords?.length || rule.keywords.some(k => article.title.toLowerCase().includes(k.toLowerCase()));
}
export function unescapeHtml(value) {
  return String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, c => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[c]));
}
export function parsePttArticlesHtml(html, board) {
  // Apply to every page; announcement articles must never enter the baseline.
  const normal = html.split(/<div\s+class=["']r-list-sep["']\s*>/)[0];
  const articles = [];
  for (const block of normal.split('<div class="r-ent">').slice(1)) {
    const link = block.match(/class="title"[^>]*>\s*<a href="([^"<>]+)">([\s\S]*?)<\/a>/);
    if (!link) continue;
    const expected = new RegExp(`^/bbs/${board.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(M\\.[A-Za-z0-9.]+)\\.html$`, 'i');
    const id = link[1].match(expected)?.[1];
    const author = block.match(/class="author">([^<]*)<\/div>/)?.[1]?.trim();
    if (!id || !author || author === '-') continue;
    const title = unescapeHtml(link[2].replace(/<[^>]*>/g, '').trim());
    if (!title || title === '批踢踢實業坊' || isDeletedArticleTitle(title)) continue;
    articles.push({ id, board, title, author, link: link[1], date: block.match(/class="date">([^<]*)<\/div>/)?.[1]?.trim() || '', nrec: block.match(/class="nrec">([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]*>/g, '').trim() || '' });
  }
  return articles;
}


// The catch-up window is frozen across rounds/restarts. Truncation is an explicit
// product policy, never evidence that the historical overlap was found.
export const DEFAULT_CATCHUP_ARTICLES = 100;
export const DEFAULT_CATCHUP_AGE_MS = 30 * 60_000;
export const MAX_CATCHUP_BYTES = 128 * 1024;
export const articlePublishedAt = a => {
  const seconds = Number(a.id?.match(/^M\.(\d+)\./)?.[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};
export async function fetchBoardPages(board, stats, request, {
  activeRequired = true, clock = Date.now, maxArticles = DEFAULT_CATCHUP_ARTICLES,
  maxAgeMs = DEFAULT_CATCHUP_AGE_MS, maxBytes = MAX_CATCHUP_BYTES,
} = {}) {
  if (!Number.isSafeInteger(maxArticles) || maxArticles < 1 || maxArticles > 1000 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > DAY ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_CATCHUP_BYTES) throw new Error('Invalid catch-up policy');
  const boundaryIds = new Set([stats.lastTopArticleId, ...(stats.overlapIds || [])].filter(Boolean));
  const dedupe = values => [...new Map(values.map(a => [a.id, a])).values()];
  const overlap = values => values.some(a => boundaryIds.has(a.id));
  const previousUrl = html => {
    const link = html.match(/<a\s+[^>]*href="(\/bbs\/[^"]+\/index\d+\.html)"[^>]*>[^<]*上頁[^<]*<\/a>/i)?.[1];
    if (!link) return null;
    const url = new URL(link, 'https://www.ptt.cc');
    return url.pathname.toLowerCase().startsWith(`/bbs/${board}/`.toLowerCase()) ? url.href : null;
  };
  let articles = [], url, observedHead, boundaryFound = false, pages = 0, reason = null;
  // Legacy continuations have no provable time window. Start a fresh bounded scan.
  const saved = stats.backfill;
  const resume = saved && Number.isFinite(saved.startedAt) && Number.isFinite(saved.cutoffAt);
  const startedAt = resume ? saved.startedAt : clock();
  const cutoffAt = resume ? Math.max(saved.cutoffAt, startedAt - maxAgeMs) : startedAt - maxAgeMs;
  const trim = values => {
    boundaryFound ||= overlap(values);
    const recent = dedupe(values).filter(a => {
      const at = articlePublishedAt(a);
      if (!boundaryFound && at !== null && at < cutoffAt) { reason ||= 'age'; return false; }
      return true;
    });
    if (!boundaryFound && (recent.length > maxArticles || (recent.length === maxArticles))) reason ||= 'count';
    articles = recent.slice(-maxArticles);
    while (new TextEncoder().encode(JSON.stringify(articles)).byteLength > maxBytes) { articles.shift(); reason ||= 'bytes'; }
  };
  if (resume) {
    observedHead = saved.observedHead;
    url = saved.nextUrl;
    trim(saved.articles || []);
    if (clock() - startedAt >= maxAgeMs) { articles = []; reason = 'deadline'; }
  } else {
    const latest = await request(`https://www.ptt.cc/bbs/${board}/index.html`, { board, kind: 'index', activeRequired });
    if (latest.status !== 'ok') return { ...latest, articles: [] };
    if (!/class=["'](?:r-ent|r-list-container)["']/.test(latest.text)) throw new Error('Invalid PTT index HTML');
    const parsed = parsePttArticlesHtml(latest.text, board);
    observedHead = parsed.at(-1)?.id || stats.lastTopArticleId || null;
    boundaryFound = !boundaryIds.size;
    trim(parsed); url = previousUrl(latest.text); pages = 1;
  }
  const continuation = () => ({ nextUrl: url, articles, observedHead, startedAt, cutoffAt });
  let deferredUntil;
  while (!reason && url && pages < 5 && (!boundaryFound || articles.length < 15)) {
    if (clock() - startedAt >= maxAgeMs) { articles = []; reason = 'deadline'; break; }
    const old = await request(url, { board, kind: 'page', activeRequired });
    if (old.status !== 'ok') { deferredUntil = old.dueAt; break; }
    if (!/class=["'](?:r-ent|r-list-container)["']/.test(old.text)) throw new Error('Invalid PTT backfill HTML');
    trim([...parsePttArticlesHtml(old.text, board), ...articles]);
    url = previousUrl(old.text); pages++;
  }
  if (clock() - startedAt >= maxAgeMs && !reason) { articles = []; reason = 'deadline'; }
  const complete = Boolean(reason || boundaryFound || !url);
  return {
    status: complete ? 'complete' : 'partial', articles, observedHead,
    boundaryFound, continuation: complete ? null : continuation(), dueAt: deferredUntil,
    catchUp: { startedAt, cutoffAt, truncated: Boolean(reason), reason, retainedCount: articles.length },
  };
}
