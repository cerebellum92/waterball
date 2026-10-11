/**
 * Waterball BBS - 24/7 PTT Article Monitor & Cloudflare Edge Worker
 * 
 * 💧 水球 BBS 終端機 - 24 小時個人雲端 PTT 文章追蹤邊緣守護程式
 * 
 * 特色：
 * 1. 100% 免費運行於 Cloudflare 全球邊緣網路（每日 100,000 次免費額度）。
 * 2. 支援從 Waterball 桌面端透過專屬金鑰「一鍵同步」所有追蹤規則與 Telegram 設定。
 * 3. 內建防 Cloudflare 蜜罐陷阱過濾、文章刪除過濾、標題與推文門檻比對。
 * 4. 24 小時背景運行，電腦休眠、關機或出門在外，也能在 Telegram 第一時間掌握關鍵情報！
 * 
 * Cloudflare 設定綁定需求：
 * - KV Namespace: PTT_TRACKER_KV (變數名稱請填 PTT_TRACKER_KV)
 * - Environment Variable (可選): SYNC_SECRET (若未設定，首次同步時自動註冊密鑰)
 * - Cron Trigger: 排程建議設為每 3 分鐘一次（cron: "* / 3 * * * *" 無空格）
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  /**
   * HTTP 請求處理 (API 端點與儀表板)
   */
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 1. 首頁狀態儀表板
    if (url.pathname === '/' || url.pathname === '/status') {
      return handleStatusDashboard(env);
    }

    // 2. 規則同步 API (POST /sync)
    if (url.pathname === '/sync' && request.method === 'POST') {
      return handleSyncConfig(request, env);
    }

    // 3. 查詢目前雲端規則 API (GET /sync)
    if (url.pathname === '/sync' && request.method === 'GET') {
      return handleGetConfig(request, env);
    }

    // 4. 手動觸發測試 API (POST /test)
    if (url.pathname === '/test' && request.method === 'POST') {
      return handleManualTest(request, env);
    }

    return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },

  /**
   * 定時排程觸發器 (Cron Trigger)
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runArticleMonitoring(env));
  },
};

/**
 * 驗證授權金鑰
 */
async function authenticateRequest(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // 1. 優先比對環境變數中的 SYNC_SECRET
  if (env.SYNC_SECRET && env.SYNC_SECRET.trim()) {
    return token === env.SYNC_SECRET.trim();
  }

  // 2. 若無環境變數，比對保存在 KV 中的 secret
  if (env.PTT_TRACKER_KV) {
    const savedSecret = await env.PTT_TRACKER_KV.get('sync_secret');
    if (savedSecret) {
      return token === savedSecret;
    } else {
      // 首次使用：自動註冊此 Token 為永久金鑰
      await env.PTT_TRACKER_KV.put('sync_secret', token);
      return true;
    }
  }

  return false;
}

/**
 * 處理狀態儀表板 (GET /)
 */
async function handleStatusDashboard(env) {
  let config = null;
  let lastCronCheck = '尚未執行';
  let totalRules = 0;
  let kvConfigured = Boolean(env.PTT_TRACKER_KV);

  if (env.PTT_TRACKER_KV) {
    try {
      config = await env.PTT_TRACKER_KV.get('config', { type: 'json' });
      lastCronCheck = (await env.PTT_TRACKER_KV.get('last_cron_time')) || '尚未執行';
      totalRules = config?.rules?.length || 0;
    } catch (_) {}
  }

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Waterball 雲端 24H 邊緣守護中心</title>
  <style>
    :root {
      --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --muted: #94a3b8;
      --accent: #38bdf8; --green: #22c55e; --border: #334155;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg); color: var(--text); margin: 0; padding: 24px;
      display: flex; justify-content: center; align-items: center; min-height: 100vh;
    }
    .card {
      background: var(--card); border: 1px solid var(--border); border-radius: 16px;
      padding: 32px; max-width: 540px; width: 100%; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
    }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .logo { font-size: 32px; }
    h1 { font-size: 20px; margin: 0; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
      border-radius: 999px; font-size: 12px; font-weight: 600;
      background: rgba(34, 197, 94, 0.15); color: var(--green); border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; }
    .stat { background: rgba(0,0,0,0.2); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border); }
    .stat-label { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .stat-val { font-size: 16px; font-weight: 600; color: var(--accent); }
    .rules-list { margin-top: 16px; font-size: 13px; }
    .rule-item {
      background: rgba(255,255,255,0.03); border: 1px solid var(--border);
      padding: 8px 12px; border-radius: 6px; margin-bottom: 6px;
    }
    .footer { margin-top: 24px; font-size: 12px; color: var(--muted); text-align: center; border-top: 1px solid var(--border); padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">💧</div>
      <div>
        <h1>Waterball 24H 雲端邊緣守護中心</h1>
        <div style="font-size: 13px; color: var(--muted); margin-top: 2px;">Cloudflare Workers 邊緣背景追蹤節點</div>
      </div>
    </div>

    <div>
      <span class="badge">● ${kvConfigured ? '服務正常運作中 (24H Online)' : '⚠️ 尚未綁定 PTT_TRACKER_KV'}</span>
    </div>

    <div class="grid">
      <div class="stat">
        <div class="stat-label">活躍追蹤規則</div>
        <div class="stat-val">${totalRules} 條</div>
      </div>
      <div class="stat">
        <div class="stat-label">Telegram 狀態</div>
        <div class="stat-val">${config?.telegram?.enabled ? '✅ 已啟用' : '⏸️ 未啟用'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">上次同步時間</div>
        <div class="stat-val" style="font-size: 13px;">${config?.updatedAt ? new Date(config.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚未同步'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">上次排程檢查</div>
        <div class="stat-val" style="font-size: 13px;">${lastCronCheck}</div>
      </div>
    </div>

    ${
      config?.rules?.length
        ? `<div class="rules-list">
            <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">📋 目前生效中的追蹤規則：</div>
            ${config.rules
              .filter((r) => r.enabled)
              .map(
                (r) => `<div class="rule-item">
                  <b>[${r.board}]</b> 
                  ${r.keywords?.length ? `關鍵字: <code>${r.keywords.join(', ')}</code>` : '全板追蹤'}
                  ${r.author ? ` | 作者: <code>${r.author}</code>` : ''}
                  ${r.minPushes > 0 ? ` | 門檻: ≥${r.minPushes}推` : ''}
                </div>`
              )
              .join('')}
          </div>`
        : `<div style="font-size: 13px; color: var(--muted); padding: 12px 0;">尚未從 Waterball 桌面端同步任何規則。請開啟 Waterball 點擊「🔄 立即同步規則至雲端」。</div>`
    }

    <div class="footer">
      本節點由您專屬的 Cloudflare 邊緣網路託管 &bull; 隱私 100% 自主掌控
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * 處理同步設定 (POST /sync)
 */
async function handleSyncConfig(request, env) {
  if (!env.PTT_TRACKER_KV) {
    return new Response(
      JSON.stringify({ success: false, message: 'Cloudflare Worker 尚未綁定 PTT_TRACKER_KV 儲存空間！' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const isAuthed = await authenticateRequest(request, env);
  if (!isAuthed) {
    return new Response(
      JSON.stringify({ success: false, message: '同步密鑰 (Secret Key) 驗證失敗，請檢查密鑰是否正確！' }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const data = await request.json();
    const rules = Array.isArray(data.rules) ? data.rules : [];
    const telegram = data.telegram || {};

    const payloadToSave = {
      rules,
      telegram,
      updatedAt: Date.now(),
    };

    await env.PTT_TRACKER_KV.put('config', JSON.stringify(payloadToSave));

    return new Response(
      JSON.stringify({
        success: true,
        message: `成功同步 ${rules.length} 筆追蹤規則至 Cloudflare 雲端！`,
        ruleCount: rules.length,
        updatedAt: payloadToSave.updatedAt,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, message: `同步資料解析失敗: ${e.message}` }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 查詢目前雲端設定 (GET /sync)
 */
async function handleGetConfig(request, env) {
  if (!env.PTT_TRACKER_KV) {
    return new Response(
      JSON.stringify({ success: false, message: '未綁定 PTT_TRACKER_KV' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const isAuthed = await authenticateRequest(request, env);
  if (!isAuthed) {
    return new Response(
      JSON.stringify({ success: false, message: '同步密鑰驗證失敗' }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const config = await env.PTT_TRACKER_KV.get('config', { type: 'json' });
  return new Response(JSON.stringify({ success: true, config: config || null }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * 手動測試端點 (POST /test)
 */
async function handleManualTest(request, env) {
  const isAuthed = await authenticateRequest(request, env);
  if (!isAuthed) {
    return new Response(JSON.stringify({ success: false, message: '未授權' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const checkResult = await runArticleMonitoring(env);
  return new Response(JSON.stringify({ success: true, result: checkResult }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ==========================================
// PTT 核心抓取、解析與推播邏輯
// ==========================================

async function runArticleMonitoring(env) {
  if (!env.PTT_TRACKER_KV) return { error: 'No KV bound' };

  const config = await env.PTT_TRACKER_KV.get('config', { type: 'json' });
  if (!config || !Array.isArray(config.rules) || config.rules.length === 0) {
    return { skipped: 'No rules configured' };
  }

  const activeRules = config.rules.filter((r) => r.enabled);
  if (activeRules.length === 0) return { skipped: 'No enabled rules' };

  // 記錄執行時間
  const nowStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  await env.PTT_TRACKER_KV.put('last_cron_time', nowStr);

  // 將看板分組處理
  const boardRulesMap = new Map();
  for (const rule of activeRules) {
    const boardKey = String(rule.board || '').trim().toLowerCase();
    if (!boardKey) continue;
    if (!boardRulesMap.has(boardKey)) {
      boardRulesMap.set(boardKey, []);
    }
    boardRulesMap.get(boardKey).push(rule);
  }

  let totalAlertsSent = 0;

  for (const [board, rules] of boardRulesMap.entries()) {
    try {
      const articles = await fetchPttBoardArticles(board);
      if (!articles || articles.length === 0) continue;

      const seenKey = `seen:${board}`;
      const seenRaw = await env.PTT_TRACKER_KV.get(seenKey, { type: 'json' });
      const seenIds = new Set(Array.isArray(seenRaw) ? seenRaw : []);

      // 初次建立基準線（不洗版）
      const isFirstScan = seenIds.size === 0;

      for (const article of articles) {
        if (!article.id || seenIds.has(article.id)) continue;

        seenIds.add(article.id);

        if (!isFirstScan) {
          const matchedRule = rules.find((rule) => matchArticleWithRule(article, rule));
          if (matchedRule && config.telegram?.enabled) {
            await sendTelegramAlert(article, config.telegram);
            totalAlertsSent++;
          }
        }
      }

      // 保留最新 300 篇 ID，設定 7 天過期，自動釋放 KV 容量
      const updatedSeen = Array.from(seenIds).slice(-300);
      await env.PTT_TRACKER_KV.put(seenKey, JSON.stringify(updatedSeen), {
        expirationTtl: 604800, // 7 days
      });
    } catch (e) {
      console.error(`[Waterball Cloud] Error processing board ${board}:`, e);
    }
  }

  return { checkedBoards: boardRulesMap.size, alertsSent: totalAlertsSent };
}

/**
 * 抓取 PTT 看板文章列表
 */
async function fetchPttBoardArticles(board) {
  const url = `https://www.ptt.cc/bbs/${board}/index.html`;
  const resp = await fetch(url, {
    headers: {
      Cookie: 'over18=1',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!resp.ok) return [];
  const html = await resp.text();
  return parsePttArticlesHtml(html, board);
}

/**
 * PTT 專用 HTML 解析器 (含防 Cloudflare 蜜罐陷阱、防刪文搜尋連結機制)
 */
function parsePttArticlesHtml(html, board) {
  const articles = [];
  // 略過 Index 0 頁首導覽與頂部蜜罐區塊
  const blocks = html.split('<div class="r-ent">').slice(1);

  for (const block of blocks) {
    const titleStart = block.indexOf('class="title"');
    if (titleStart === -1) continue;
    const titleBlock = block.slice(titleStart);
    const titleEnd = titleBlock.indexOf('</div>');
    if (titleEnd === -1) continue;
    const titleSection = titleBlock.slice(0, titleEnd);

    const linkStart = titleSection.indexOf('<a href="');
    if (linkStart === -1) continue; // 已刪除文章無標籤連結
    const afterHref = titleSection.slice(linkStart + 9);
    const linkEnd = afterHref.indexOf('"');
    if (linkEnd === -1) continue;
    const rawLink = afterHref.slice(0, linkEnd).trim();

    // 嚴格拒絕 cdn-cgi 蜜罐、搜尋端點與非 BBS 文章連結
    if (
      rawLink.includes('cdn-cgi') ||
      rawLink.includes('search?') ||
      rawLink.includes('javascript:') ||
      !rawLink.includes('/bbs/')
    ) {
      continue;
    }

    const bbsIdx = rawLink.indexOf('/bbs/');
    const link = bbsIdx !== -1 ? rawLink.slice(bbsIdx) : rawLink;
    if (!link.endsWith('.html')) continue;

    const parts = link.split('/');
    const id = parts[parts.length - 1].replace(/\.html$/, '');
    if (!id.startsWith('M.')) continue;

    const afterQuote = afterHref.slice(linkEnd);
    const tagEnd = afterQuote.indexOf('>');
    if (tagEnd === -1) continue;
    const closeA = afterQuote.indexOf('</a>');
    if (closeA === -1) continue;
    const title = unescapeHtml(afterQuote.slice(tagEnd + 1, closeA).trim());
    if (!title || title === '批踢踢實業坊') continue;

    const authorMatch = block.match(/class="author">([^<]*)<\/div>/);
    const author = authorMatch ? authorMatch[1].trim() : '';
    if (!author || author === '-') continue;

    const dateMatch = block.match(/class="date">([^<]*)<\/div>/);
    const date = dateMatch ? dateMatch[1].trim() : '';

    const nrecMatch = block.match(/class="nrec">([\s\S]*?)<\/div>/);
    const nrec = nrecMatch ? nrecMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    articles.push({ id, title, author, date, nrec, link, board });
  }

  return articles;
}

function unescapeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function matchArticleWithRule(article, rule) {
  if (!rule.enabled) return false;
  if (article.board.toLowerCase() !== rule.board.toLowerCase()) return false;

  if (rule.author && article.author.toLowerCase() !== rule.author.toLowerCase()) {
    return false;
  }

  if (rule.minPushes > 0) {
    let pushCount = 0;
    if (article.nrec === '爆') pushCount = 100;
    else if (article.nrec === 'XX') pushCount = -100;
    else pushCount = parseInt(article.nrec, 10) || 0;
    if (pushCount < rule.minPushes) return false;
  }

  if (rule.keywords && rule.keywords.length > 0) {
    const titleLower = article.title.toLowerCase();
    const matched = rule.keywords.some((kw) => titleLower.includes(String(kw).toLowerCase()));
    if (!matched) return false;
  }

  return true;
}

/**
 * 發送 Telegram 即時推播
 */
async function sendTelegramAlert(article, tgConfig) {
  let token = String(tgConfig.botToken || '').trim();
  const chatId = String(tgConfig.chatId || '').trim();
  if (!token || !chatId) return;

  // 自動清除任何 URL 前綴與多餘 bot 前綴
  const botIdx = token.indexOf('/bot');
  if (botIdx !== -1) token = token.slice(botIdx + 4);
  const sendIdx = token.indexOf('/sendMessage');
  if (sendIdx !== -1) token = token.slice(0, sendIdx);
  if (token.toLowerCase().startsWith('bot')) {
    const after = token.slice(3);
    if (/^\d/.test(after)) token = after;
  }
  token = token.replace(/^\/+|\/+$/g, '').trim();

  const escapeHtml = (str) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const board = escapeHtml(article.board);
  const title = escapeHtml(article.title);
  const author = escapeHtml(article.author);
  const nrec = escapeHtml(article.nrec ? `${article.nrec}推` : '0推');
  const fullUrl = `https://www.ptt.cc${article.link.startsWith('/') ? '' : '/'}${article.link}`;

  const messageText = [
    `🚨 <b>【Waterball 雲端 24H 追蹤推播】</b>`,
    `📌 <b>看板</b>：#${board}`,
    `📝 <b>標題</b>：${title}`,
    `👤 <b>作者</b>：${author}`,
    `🔥 <b>推文</b>：${nrec}`,
    `🔗 <a href="${fullUrl}">${fullUrl}</a>`,
  ].join('\n');

  const tgApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(tgApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      disable_notification: Boolean(tgConfig.silent),
    }),
  });
}
