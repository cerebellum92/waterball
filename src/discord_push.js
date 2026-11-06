// Discord Webhook Push Notification Module for Waterball BBS

export function isValidDiscordWebhookUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const validHost = ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'].includes(host);
    if (!validHost) return false;
    if (parsed.username || parsed.password || parsed.port || parsed.hash) return false;
    if ([...parsed.searchParams.keys()].some((k) => k !== 'wait') || (parsed.search && parsed.searchParams.get('wait') !== 'true')) {
      return false;
    }
    return /^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function normalizeDiscordWebhookUrl(url) {
  if (!isValidDiscordWebhookUrl(url)) return '';
  const parsed = new URL(url.trim());
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
}

export function safePttArticleUrl(link, board = '') {
  let raw = String(link || '').trim();
  const cleanBoard = String(board || '').trim();
  const fallback = cleanBoard ? `https://www.ptt.cc/bbs/${encodeURIComponent(cleanBoard)}/index.html` : 'https://www.ptt.cc';
  if (!raw) return fallback;

  while (raw.startsWith('https://www.ptt.cchttps://www.ptt.cc')) raw = raw.slice('https://www.ptt.cc'.length);
  while (raw.startsWith('http://www.ptt.cchttp://www.ptt.cc')) raw = raw.slice('http://www.ptt.cc'.length);

  let target = raw;
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    const cleanPath = target.startsWith('/') ? target : `/${target}`;
    target = `https://www.ptt.cc${cleanPath}`;
  }

  try {
    const parsed = new URL(target);
    if (parsed.protocol === 'https:' && parsed.hostname === 'www.ptt.cc' && !parsed.username && !parsed.password && !parsed.port) {
      return parsed.href.replace(/[()]/g, c => c === '(' ? '%28' : '%29');
    }
  } catch {}

  return fallback;
}

export function formatDiscordArticlePayload(item) {
  const board = String(item.board || '').trim().slice(0, 32);
  const title = Array.from(String(item.title || '').trim()).slice(0, 256).join('') || '（無標題）';
  const author = Array.from(String(item.author || '').trim()).slice(0, 1024).join('') || '未知';
  const nrec = String(item.nrec ? (item.nrec === '爆' ? '爆推' : `${item.nrec}推`) : '0推').trim();
  const link = safePttArticleUrl(item.link, board);

  let color = 0x3498DB; // Default blue
  if (item.nrec) {
    const nrecStr = String(item.nrec);
    const nrecNum = parseInt(nrecStr, 10);
    if (nrecStr.includes('爆') || nrecNum >= 100) {
      color = 0xF1C40F; // Gold
    } else if (nrecStr.includes('X') || nrecNum < 0) {
      color = 0xE74C3C; // Red
    } else if (nrecNum > 0) {
      color = 0x2ECC71; // Green
    }
  }

  return {
    allowed_mentions: { parse: [] },
    username: 'Waterball 水球',
    avatar_url: 'https://raw.githubusercontent.com/cerebellum92/waterball/main/icons/128x128.png',
    embeds: [
      {
        title,
        url: link,
        description: '📢 PTT 文章追蹤命中通知',
        color,
        fields: [
          { name: '📌 看板', value: board ? `[${board}](https://www.ptt.cc/bbs/${encodeURIComponent(board)}/index.html)` : '未知', inline: true },
          { name: '👤 作者', value: author, inline: true },
          { name: '🔥 推文', value: nrec, inline: true },
        ],
        footer: {
          text: 'Waterball PTT 文章監控・偵測時間',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function createDiscordTestPayload() {
  return {
    allowed_mentions: { parse: [] },
    username: 'Waterball 水球',
    avatar_url: 'https://raw.githubusercontent.com/cerebellum92/waterball/main/icons/128x128.png',
    embeds: [
      {
        title: '🎉 Waterball Discord 推播測試成功！',
        description: '這是一則來自 **Waterball (水球) PTT 連線軟體** 的推播測試通知。\n當您設定的文章監控規則觸發時，符合條件的文章就會即時發送到這個頻道！',
        color: 0x2ECC71,
        fields: [
          { name: '連線狀態', value: '🟢 正常運作中', inline: true },
          { name: '測試時間', value: new Date().toLocaleString(), inline: true },
        ],
        footer: {
          text: 'Waterball PTT 文章監控',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function createDiscordDigestPayload(items) {
  // PTT article IDs contain the publication timestamp. Preserve feed order as a fallback.
  const published = a => { const value = Number(String(a.id || '').match(/^M\.(\d+)\./)?.[1]); return Number.isFinite(value) && value > 0 ? value : null; };
  const sorted = items.map((a, index) => ({ a, index, at: published(a) })).sort((x, y) => x.at !== null && y.at !== null ? y.at - x.at || y.index - x.index : x.at !== null ? -1 : y.at !== null ? 1 : y.index - x.index).map(x => x.a);
  const shown = sorted.slice(0, 5);
  const remainder = sorted.length - shown.length;

  const lines = shown.map((a) => {
    const card = formatDiscordArticlePayload(a).embeds[0];
    const escapeMarkdown = value => String(value).replace(/[\\`*_{}\[\]()<>~|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
    const cleanTitle = escapeMarkdown(card.title);
    const boardTag = a.board ? `**[${escapeMarkdown(String(a.board).trim())}]** ` : '';
    return `• ${boardTag}[${cleanTitle}](${card.url})`;
  });

  const desc =
    `本批共有 ${sorted.length} 篇符合條件；以下列出最新 ${shown.length} 篇：\n` +
    lines.join('\n') +
    (remainder > 0 ? `\n\n*其餘 ${remainder} 篇已合併計入本摘要。*` : '');

  return {
    allowed_mentions: { parse: [] },
    username: 'Waterball 水球',
    avatar_url: 'https://raw.githubusercontent.com/cerebellum92/waterball/main/icons/128x128.png',
    embeds: [
      {
        title: `📚 ${sorted.length} 篇文章追蹤摘要`,
        description: desc.slice(0, 4000),
        color: 0x3498DB,
        footer: { text: 'Waterball PTT 文章監控・偵測時間' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
