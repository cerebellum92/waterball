// Waterball AI Article Summary Client
import { DEFAULT_OFFICIAL_WORKER_URL } from './article_monitor.js';
import { urlToAid, aidToUrl } from './aid_helper.js';
import { sampleSummaryPushes, fitSummaryPayload } from '../shared/summary-input.js';

export function getSummaryServiceUrl() {
  return DEFAULT_OFFICIAL_WORKER_URL;
}

export function formatArticleForSummary(article) {
  if (!article) return '';
  const body = (article.bodyBlocks || [])
    .map((b) => b.text || '')
    .join('\n')
    .slice(0, 10000);

  const pushes = article.pushList || [];
  let pushText = '';
  if (pushes.length <= 200) {
    pushText = pushes.map((p) => `${p.tag} ${p.user}: ${p.content}`).join('\n');
  } else {
    const selected = sampleSummaryPushes(pushes).map(p => `${p.tag} ${p.user}: ${p.content}`);
    const head = selected.slice(0, 60).join('\n');
    const mid = selected.slice(60, 120).join('\n');
    const tail = selected.slice(120).join('\n');
    pushText = `${head}\n...(前中段略過)...\n${mid}\n...(中後段略過)...\n${tail}`;
  }

  const stats = article.pushStats || { push: 0, boo: 0, arrow: 0 };
  const statLine = `推文統計：推 ${stats.push || 0} / 噓 ${stats.boo || 0} / 箭頭 ${stats.arrow || 0} (共 ${pushes.length} 則)`;

  return `【文章內文】\n${body}\n\n【${statLine}】\n${pushText}`.slice(0, 16000);
}

export async function fetchArticleSummary(article, options = {}) {
  const { forceRefresh = false, serviceUrl = null } = options;
  const baseUrl = (serviceUrl || getSummaryServiceUrl()).replace(/\/+$/, '');
  const url = `${baseUrl}/summary`;

  const pushes = article.pushList || [];
  let articleUrl = urlToAid(article.webUrl)?.url ||
    (article.aid ? aidToUrl(article.board, article.aid) : null) ||
    (article.board && article.articleId ? urlToAid(`https://www.ptt.cc/bbs/${article.board}/${article.articleId}.html`)?.url : null);

  if (!articleUrl) return { success: false, message: '無法取得此文章的 PTT 網址，無法產生 AI 懶人包' };

  const payload = fitSummaryPayload({
    articleUrl,
    pushCount: pushes.length,
    forceRefresh: Boolean(forceRefresh),
    fallback: {
      title: article.title || '',
      body: (article.bodyBlocks || []).map(b => b.text || '').join('\n'),
      pushes: pushes.map(p => `${p.tag} ${p.user}: ${p.content}`),
      pushCount: pushes.length,
      truncated: false,
    },
  });

  if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
    try {
      const data = await window.__TAURI__.core.invoke('cloud_push_request', {
        workerUrl: url,
        secretKey: '',
        method: 'POST',
        payloadJson: JSON.stringify(payload),
      });
      return data;
    } catch (e) {
      return { success: false, message: typeof e === 'string' ? e : e?.message || 'AI 摘要連線失敗' };
    }
  }

  let timer;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 32000);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data;
    if (typeof response.text === 'function') {
      const rawText = await response.text();
      try {
        data = JSON.parse(rawText);
      } catch {
        return {
          success: false,
          message: response.status === 502
            ? 'AI 摘要伺服器忙碌或處理中斷 (HTTP 502)，請稍後重試'
            : `伺服器回應異常 (HTTP ${response.status})，請稍後重試`,
        };
      }
    } else if (typeof response.json === 'function') {
      try {
        data = await response.json();
      } catch {
        return {
          success: false,
          message: response.status === 502
            ? 'AI 摘要伺服器忙碌或處理中斷 (HTTP 502)，請稍後重試'
            : `伺服器回應異常 (HTTP ${response.status})，請稍後重試`,
        };
      }
    } else {
      return { success: false, message: '無法解析伺服器回應' };
    }
    return data;
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    return {
      success: false,
      message: isTimeout ? '連線逾時，Gemini 分析較耗時請稍後重試' : '無法連線至 AI 摘要服務，請檢查網路連線',
    };
  } finally { clearTimeout(timer); }
}
