import { articleKey, articlePublishedAt, escapeHtml, matchArticleWithRule } from './push-rules.js';

export const NOTIFICATION_WINDOW_MS = 5 * 60_000;
export const NOTIFICATION_LIMIT = 3;
export const MAX_DIGEST_ARTICLES = 100;
export const notificationArticles = job => Array.isArray(job.articles) ? job.articles : job.article ? [job.article] : [];
export const notificationMatches = (job, rules) => notificationArticles(job).length > 0 && notificationArticles(job).every(a => rules.some(r => matchArticleWithRule(a, r, true)));
export const coversArticle = (job, article) => notificationArticles(job).some(a => articleKey(a) === articleKey(article));
export function revalidateNotification(job, rules) {
  if (job.kind === 'reminder') return job;
  const members = notificationArticles(job), remaining = members.filter(a => rules.some(r => matchArticleWithRule(a, r, true)));
  if (!remaining.length) return null;
  if (remaining.length === members.length) return job;
  // Configuration edits cancel the old snapshot and create a new identity. Ordinary
  // retries still never change membership. Keep attempts/TTL/budget conservative.
  const originalId = job.originalId || job.id, generation = (job.generation || 0) + 1;
  const isDigest = remaining.length >= 4;
  return { ...job, id: `${originalId}:v${generation}`, originalId, generation,
    article: remaining[0], articles: isDigest ? remaining : undefined, digest: isDigest };
}
export function notificationDue(starts, now) {
  const recent = (starts || []).filter(at => Number.isFinite(at) && at > now - NOTIFICATION_WINDOW_MS).sort((a, b) => a - b);
  return recent.length >= NOTIFICATION_LIMIT ? recent[recent.length - NOTIFICATION_LIMIT] + NOTIFICATION_WINDOW_MS : now;
}
export function reserveNotification(owner, now) {
  owner.notificationStarts = (owner.notificationStarts || []).filter(at => Number.isFinite(at) && at > now - NOTIFICATION_WINDOW_MS);
  owner.notificationStarts.push(now);
}
// Only unsent, unsealed jobs are mutable. A failed/ambiguous send retries its exact snapshot.
export function coalesceNotifications(jobs, now, ownerFor, valid) {
  const groups = new Map();
  for (const job of jobs) {
    if (job.kind === 'reminder' || job.sealed || job.attempts !== 0 || !valid(job)) continue;
    // Keep old work from shortening a newly arrived article's TTL by almost 30 minutes.
    const key = `${job.userKey || 'owner'}:${job.epoch}:${Math.floor(job.createdAt / NOTIFICATION_WINDOW_MS)}`;
    const group = groups.get(key) || []; group.push(job); groups.set(key, group);
  }
  const removed = new Set(), replacements = [];
  for (const group of groups.values()) {
    const owner = ownerFor(group[0]);
    const isUndelivered = a => !owner?.delivered?.[articleKey(a)];
    for (const j of group) {
      const remainingArticles = notificationArticles(j).filter(isUndelivered);
      if (remainingArticles.length === 0) removed.add(j.id);
    }
    const all = [...new Map(group.flatMap(notificationArticles).filter(isUndelivered).map(a => [articleKey(a), a])).values()];
    if (all.length === 0) continue;

    if (all.length <= 3) {
      if (!group.some(j => j.digest || removed.has(j.id))) continue;
      for (const j of group) removed.add(j.id);
      for (const a of all) {
        const id = `${group[0].userKey || 'owner'}:${group[0].epoch}:${articleKey(a)}`;
        const original = group.find(j => coversArticle(j, a)) || group[0];
        replacements.push({
          ...original,
          id,
          article: a,
          articles: undefined,
          digest: false,
          attempts: 0,
        });
      }
      continue;
    }
    // Only coalesce into a digest if there are 4 or more unpushed articles.
    for (const j of group) removed.add(j.id);
    let offset = 0;
    for (let i = 0; offset < all.length; i++) {
      const members = all.slice(offset, offset + MAX_DIGEST_ARTICLES); offset += members.length;
      const first = group[i] || group[0];
      replacements.push({
        ...first,
        article: members[0],
        articles: members,
        digest: true,
        catchUpLimited: group.some(j => j.catchUpLimited),
        createdAt: Math.min(...group.map(j => j.createdAt)),
        nextAttemptAt: Math.max(now, Math.min(...group.map(j => j.nextAttemptAt))),
        attempts: 0,
      });
    }
  }
  return [...jobs.filter(j => !removed.has(j.id)), ...replacements];
}
export function digestPayload(job, chatId, silent) {
  const articles = notificationArticles(job);
  const shown = articles.map((a, index) => ({ a, index })).sort((x, y) => (articlePublishedAt(y.a) || y.index) - (articlePublishedAt(x.a) || x.index)).slice(0, 5).map(x => x.a);
  const text = `📚 <b>Waterball 追蹤摘要</b>\n本批共有 ${articles.length} 篇符合條件；以下列出其中最新 ${shown.length} 篇：\n${job.catchUpLimited ? '較早文章已依補抓範圍略過，持續追蹤新文章。\n' : ''}\n` +
    shown.map(a => `<b>[${escapeHtml(a.board.slice(0, 32))}]</b> <a href="https://www.ptt.cc/bbs/${encodeURIComponent(a.board)}/${encodeURIComponent(a.id)}.html">${escapeHtml(a.title.slice(0, 100))}</a>`).join('\n\n') +
    (articles.length > shown.length ? `\n\n其餘 ${articles.length - shown.length} 篇已合併計入本摘要，不再逐篇補送。` : '');
  return { chat_id: chatId, text, parse_mode: 'HTML', disable_notification: Boolean(silent), disable_web_page_preview: true, link_preview_options: { is_disabled: true } };
}
