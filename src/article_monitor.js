// Local PTT Article Monitor & Push Notification Engine for Waterball BBS

import { sendNativeNotification } from './platform.js';

export const DEFAULT_MONITOR_RULES = [
  {
    id: 'default_stock',
    board: 'Stock',
    keywords: ['情報'],
    author: '',
    minPushes: 0,
    enabled: true,
  },
  {
    id: 'default_lifeismoney',
    board: 'Lifeismoney',
    keywords: [],
    author: '',
    minPushes: 10,
    enabled: true,
  },
];

export function formatTelegramArticleMessage(item) {
  const escapeHtml = (str) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const board = escapeHtml(item.board);
  const title = escapeHtml(item.title);
  const author = escapeHtml(item.author || '未知');
  const nrec = escapeHtml(item.nrec ? `${item.nrec}推` : '0推');
  const link = item.link?.startsWith('http')
    ? item.link
    : `https://www.ptt.cc${item.link?.startsWith('/') ? '' : '/'}${item.link || `bbs/${item.board}/index.html`}`;

  return [
    `🚨 <b>【Waterball PTT 文章追蹤通知】</b>`,
    `📌 <b>看板</b>：#${board}`,
    `📝 <b>標題</b>：${title}`,
    `👤 <b>作者</b>：${author}`,
    `🔥 <b>推文</b>：${nrec}`,
    `🔗 <a href="${link}">${link}</a>`,
  ].join('\n');
}

export class ArticleMonitorManager {
  constructor(
    storage = (typeof localStorage !== 'undefined' ? localStorage : null),
    fetchFn = null,
    telegramSendFn = null
  ) {
    this.storage = storage;
    this.customFetch = fetchFn;
    this.customTelegramSend = telegramSendFn;
    this.rules = this.loadRules();
    this.history = this.loadHistory();
    this.seenIds = this.loadSeenIds();
    this.telegramConfig = this.loadTelegramConfig();
    this.initializedBoards = new Set();
    this.intervalMinutes = 3;
    this.timer = null;
    this.isChecking = false;
    this.lastCheckedTime = 0;
    this.listeners = [];
    this.onNewAlert = null;
  }

  loadRules() {
    if (!this.storage) return [...DEFAULT_MONITOR_RULES];
    try {
      const raw = this.storage.getItem('bbsterm_monitor_rules');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load monitor rules:', e);
    }
    return [...DEFAULT_MONITOR_RULES];
  }

  saveRules() {
    if (!this.storage) return;
    try {
      this.storage.setItem('bbsterm_monitor_rules', JSON.stringify(this.rules));
    } catch (e) {
      console.warn('Failed to save monitor rules:', e);
    }
    this.notify();
  }

  loadHistory() {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem('bbsterm_monitor_history');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load monitor history:', e);
    }
    return [];
  }

  saveHistory() {
    if (!this.storage) return;
    try {
      this.storage.setItem('bbsterm_monitor_history', JSON.stringify(this.history));
    } catch (e) {
      console.warn('Failed to save monitor history:', e);
    }
    this.notify();
  }

  loadSeenIds() {
    if (!this.storage) return new Set();
    try {
      const raw = this.storage.getItem('bbsterm_monitor_seen');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch (e) {
      console.warn('Failed to load seen article IDs:', e);
    }
    return new Set();
  }

  saveSeenIds() {
    if (!this.storage) return;
    try {
      // Keep at most 600 latest seen IDs
      const arr = Array.from(this.seenIds).slice(-600);
      this.storage.setItem('bbsterm_monitor_seen', JSON.stringify(arr));
    } catch (e) {
      console.warn('Failed to save seen article IDs:', e);
    }
  }

  // --- Telegram Push Forwarding ---

  loadTelegramConfig() {
    if (!this.storage) {
      return { enabled: false, botToken: '', chatId: '', silent: false };
    }
    try {
      const raw = this.storage.getItem('bbsterm_monitor_telegram');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: Boolean(parsed.enabled),
          botToken: String(parsed.botToken || '').trim(),
          chatId: String(parsed.chatId || '').trim(),
          silent: Boolean(parsed.silent),
        };
      }
    } catch (e) {
      console.warn('Failed to load Telegram config:', e);
    }
    return { enabled: false, botToken: '', chatId: '', silent: false };
  }

  saveTelegramConfig(config) {
    this.telegramConfig = {
      enabled: Boolean(config.enabled),
      botToken: String(config.botToken || '').trim(),
      chatId: String(config.chatId || '').trim(),
      silent: Boolean(config.silent),
    };
    if (this.storage) {
      try {
        this.storage.setItem('bbsterm_monitor_telegram', JSON.stringify(this.telegramConfig));
      } catch (e) {
        console.warn('Failed to save Telegram config:', e);
      }
    }
    this.notify();
  }

  getTelegramConfig() {
    return { ...this.telegramConfig };
  }

  async sendTelegramRawMessage(botToken, chatId, text, silent = false) {
    if (this.customTelegramSend) {
      return this.customTelegramSend(botToken, chatId, text, silent);
    }
    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke('send_telegram_message', {
          botToken,
          chatId,
          text,
          silent: Boolean(silent),
        });
      } catch (e) {
        console.warn('[ArticleMonitor] Telegram send failed via Tauri:', e);
        return { success: false, message: String(e) };
      }
    }
    return { success: false, message: 'Tauri runtime not available' };
  }

  async sendTelegramAlert(alertItem) {
    if (!this.telegramConfig?.enabled) return null;
    const { botToken, chatId, silent } = this.telegramConfig;
    if (!botToken || !chatId) return null;

    const text = formatTelegramArticleMessage(alertItem);
    return this.sendTelegramRawMessage(botToken, chatId, text, silent);
  }

  async testTelegram(botToken, chatId) {
    const cleanToken = String(botToken || '').trim();
    const cleanChatId = String(chatId || '').trim();
    if (!cleanToken || !cleanChatId) {
      return { success: false, message: '請填寫完整的 Bot Token 與 Chat ID' };
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const testText = [
      `💧 <b>【Waterball】Telegram 推播連線測試成功！</b>`,
      `🕒 測試時間：${timeStr}`,
      `🔔 您的 Telegram 推播已設定完成。電腦於背景監測到符合條件的 PTT 新文章時，將會即時發送通知至此處。`,
    ].join('\n');

    return this.sendTelegramRawMessage(cleanToken, cleanChatId, testText, false);
  }

  addListener(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (e) {
        console.error('Error in monitor listener:', e);
      }
    }
  }

  // --- Rule Management ---

  getRules() {
    return [...this.rules];
  }

  addRule({ board, keywords = [], author = '', minPushes = 0, enabled = true }) {
    const cleanBoard = String(board || '').trim();
    if (!cleanBoard) return null;

    const newRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      board: cleanBoard,
      keywords: Array.isArray(keywords)
        ? keywords.map((k) => String(k).trim()).filter(Boolean)
        : String(keywords)
            .split(/[,，\s]+/)
            .map((k) => k.trim())
            .filter(Boolean),
      author: String(author || '').trim(),
      minPushes: Math.max(0, parseInt(minPushes, 10) || 0),
      enabled: enabled !== false,
    };

    this.rules.push(newRule);
    this.saveRules();

    // Trigger an immediate check for this new rule's board to establish baseline
    this.checkBoard(newRule.board).catch(() => {});
    return newRule;
  }

  updateRule(id, updates) {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;

    if (updates.board !== undefined) updates.board = String(updates.board).trim();
    if (updates.keywords !== undefined && !Array.isArray(updates.keywords)) {
      updates.keywords = String(updates.keywords)
        .split(/[,，\s]+/)
        .map((k) => k.trim())
        .filter(Boolean);
    }
    if (updates.minPushes !== undefined) {
      updates.minPushes = Math.max(0, parseInt(updates.minPushes, 10) || 0);
    }

    this.rules[idx] = { ...this.rules[idx], ...updates };
    this.saveRules();
    return true;
  }

  deleteRule(id) {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.saveRules();
  }

  toggleRule(id) {
    const rule = this.rules.find((r) => r.id === id);
    if (rule) {
      rule.enabled = !rule.enabled;
      this.saveRules();
    }
  }

  // --- History & Alerts ---

  getHistory() {
    return [...this.history];
  }

  getUnreadCount() {
    return this.history.filter((h) => !h.isRead).length;
  }

  markAllRead() {
    let changed = false;
    for (const h of this.history) {
      if (!h.isRead) {
        h.isRead = true;
        changed = true;
      }
    }
    if (changed) {
      this.saveHistory();
    }
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
  }

  addAlertItem(item) {
    this.history.unshift(item);
    if (this.history.length > 100) {
      this.history.pop();
    }
    this.saveHistory();
  }

  // --- Matching Engine ---

  matchesRule(article, rule) {
    if (!rule.enabled) return false;
    if (article.board.toLowerCase() !== rule.board.toLowerCase()) return false;

    // Author check
    if (rule.author) {
      if (article.author.toLowerCase() !== rule.author.toLowerCase()) {
        return false;
      }
    }

    // Min pushes check
    if (rule.minPushes > 0) {
      let pushCount = 0;
      if (article.nrec === '爆') {
        pushCount = 100;
      } else if (article.nrec === 'XX') {
        pushCount = -100;
      } else {
        pushCount = parseInt(article.nrec, 10) || 0;
      }
      if (pushCount < rule.minPushes) {
        return false;
      }
    }

    // Keywords check: if rule specifies keywords, at least one must match (case-insensitive)
    if (rule.keywords && rule.keywords.length > 0) {
      const titleLower = article.title.toLowerCase();
      const matched = rule.keywords.some((kw) => titleLower.includes(kw.toLowerCase()));
      if (!matched) return false;
    }

    return true;
  }

  // --- Article Fetcher & Polling ---

  async fetchBoardArticles(board) {
    if (this.customFetch) {
      return this.customFetch(board);
    }
    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke('fetch_ptt_board_articles', { board });
      } catch (e) {
        console.warn(`[ArticleMonitor] Failed to fetch board ${board} via Tauri:`, e);
        return [];
      }
    }
    return [];
  }

  async checkBoard(board) {
    const cleanBoard = String(board || '').trim();
    if (!cleanBoard) return [];

    const activeRules = this.rules.filter(
      (r) => r.enabled && r.board.toLowerCase() === cleanBoard.toLowerCase()
    );
    if (activeRules.length === 0) return [];

    const articles = await this.fetchBoardArticles(cleanBoard);
    if (!Array.isArray(articles) || articles.length === 0) return [];

    const isFirstTime = !this.initializedBoards.has(cleanBoard.toLowerCase());
    const newAlerts = [];

    for (const article of articles) {
      if (!article.id) continue;

      if (!this.seenIds.has(article.id)) {
        this.seenIds.add(article.id);

        // Baseline protection: do not spam notifications on the first scan of a board
        if (!isFirstTime) {
          const matchedRule = activeRules.find((rule) => this.matchesRule(article, rule));
          if (matchedRule) {
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const alertItem = {
              id: article.id,
              board: article.board,
              title: article.title,
              author: article.author,
              date: article.date,
              nrec: article.nrec,
              link: article.link,
              matchedRuleId: matchedRule.id,
              timestamp: Date.now(),
              timeStr,
              isRead: false,
            };

            this.addAlertItem(alertItem);
            newAlerts.push(alertItem);

            // Native desktop push notification
            const notifTitle = `📢 [${alertItem.board}] 新文章通知`;
            const notifBody = `${alertItem.title} (${alertItem.author}${alertItem.nrec ? ` | ${alertItem.nrec}推` : ''})`;
            sendNativeNotification(notifTitle, notifBody, () => {
              this.onNewAlert?.(alertItem);
            }).catch(() => {});

            // Forward to Telegram if enabled
            this.sendTelegramAlert(alertItem).catch((e) => {
              console.warn('[ArticleMonitor] Telegram forward error:', e);
            });
          }
        }
      }
    }

    this.initializedBoards.add(cleanBoard.toLowerCase());
    this.saveSeenIds();
    return newAlerts;
  }

  async checkAll() {
    if (this.isChecking) return [];
    this.isChecking = true;
    this.notify();

    const enabledBoards = Array.from(
      new Set(
        this.rules
          .filter((r) => r.enabled)
          .map((r) => r.board.trim())
          .filter(Boolean)
      )
    );

    const allNewAlerts = [];
    for (const board of enabledBoards) {
      try {
        const alerts = await this.checkBoard(board);
        allNewAlerts.push(...alerts);
      } catch (e) {
        console.warn(`[ArticleMonitor] Error checking board ${board}:`, e);
      }
      // Gentle delay between board queries
      await new Promise((r) => setTimeout(r, 400));
    }

    this.lastCheckedTime = Date.now();
    this.isChecking = false;
    this.notify();
    return allNewAlerts;
  }

  startScheduler(intervalMinutes = this.intervalMinutes) {
    this.stopScheduler();
    this.intervalMinutes = Math.max(1, intervalMinutes);

    // Initial check after 3 seconds
    setTimeout(() => {
      this.checkAll().catch(() => {});
    }, 3000);

    // Recurring interval
    this.timer = setInterval(() => {
      this.checkAll().catch(() => {});
    }, this.intervalMinutes * 60 * 1000);
  }

  stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const articleMonitorManager = new ArticleMonitorManager();
