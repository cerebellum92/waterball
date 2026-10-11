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

export function normalizeTelegramBotToken(token) {
  let clean = String(token || '').trim();
  const botIdx = clean.indexOf('/bot');
  if (botIdx !== -1) {
    clean = clean.slice(botIdx + 4);
  }
  const sendIdx = clean.indexOf('/sendMessage');
  if (sendIdx !== -1) {
    clean = clean.slice(0, sendIdx);
  }
  if (clean.toLowerCase().startsWith('bot')) {
    const after = clean.slice(3);
    if (/^\d/.test(after)) {
      clean = after;
    }
  }
  return clean.replace(/^\/+|\/+$/g, '').trim();
}

export function normalizePttArticleUrl(link, board = '') {
  let raw = String(link || '').trim();
  if (!raw) {
    return board ? `https://www.ptt.cc/bbs/${board}/index.html` : 'https://www.ptt.cc';
  }
  // Strip duplicate domain prefixes (e.g. https://www.ptt.cchttps://www.ptt.cc)
  while (raw.startsWith('https://www.ptt.cchttps://www.ptt.cc')) {
    raw = raw.slice('https://www.ptt.cc'.length);
  }
  while (raw.startsWith('http://www.ptt.cchttp://www.ptt.cc')) {
    raw = raw.slice('http://www.ptt.cc'.length);
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
  return `https://www.ptt.cc${cleanPath}`;
}

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
  const link = normalizePttArticleUrl(item.link, item.board);

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
    telegramSendFn = null,
    cloudSyncFn = null
  ) {
    this.storage = storage;
    this.customFetch = fetchFn;
    this.customTelegramSend = telegramSendFn;
    this.customCloudSync = cloudSyncFn;
    this.rules = this.loadRules();
    this.history = this.loadHistory();
    this.seenIds = this.loadSeenIds();
    this.telegramConfig = this.loadTelegramConfig();
    this.cloudSyncConfig = this.loadCloudSyncConfig();
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
    if (this.cloudSyncConfig?.enabled && this.cloudSyncConfig?.autoSync && this.cloudSyncConfig?.workerUrl) {
      this.syncToCloud().catch(() => {});
    }
  }

  loadHistory() {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem('bbsterm_monitor_history');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => {
            if (!item || !item.link) return false;
            const strLink = String(item.link);
            const strId = String(item.id || '');
            if (strLink.includes('cdn-cgi') || strId.startsWith('content?')) return false;
            if (item.title === '批踢踢實業坊' && (!item.author || item.author === '-')) return false;
            return true;
          });
        }
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
        if (Array.isArray(parsed)) {
          return new Set(
            parsed.filter((id) => {
              const strId = String(id || '');
              return !strId.startsWith('content?') && !strId.includes('cdn-cgi');
            })
          );
        }
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
      botToken: normalizeTelegramBotToken(config.botToken),
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
    if (this.cloudSyncConfig?.enabled && this.cloudSyncConfig?.autoSync && this.cloudSyncConfig?.workerUrl) {
      this.syncToCloud().catch(() => {});
    }
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
    const cleanToken = normalizeTelegramBotToken(botToken);
    const cleanChatId = String(chatId || '').trim();
    if (!cleanToken || !cleanChatId) {
      return { success: false, message: '請填寫完整的 Bot Token 與 Chat ID' };
    }

    if (cleanToken.startsWith('@') || cleanToken.startsWith('t.me/')) {
      return {
        success: false,
        message: 'Bot Token 填寫錯誤：您似乎填寫成了機器人帳號或連結（例如 @xxx_bot），請填寫 @BotFather 發給的「HTTP API Token」（格式應為 123456789:ABCdef...）',
      };
    }

    if (!cleanToken.includes(':')) {
      if (cleanChatId.includes(':')) {
        return {
          success: false,
          message: '您似乎把「Bot Token」和「Chat ID」的位置填反了！Bot Token 應包含冒號（例如 123456789:ABC...），而 Chat ID 通常為純數字（例如 987654321）。',
        };
      }
      return {
        success: false,
        message: 'Bot Token 格式錯誤：有效的 Telegram Bot Token 必須包含冒號「:」（格式為 數字:英數代碼，例如 123456789:AA...）。請檢查是否複製不完整或誤填。',
      };
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

  // --- Cloudflare 24H Edge Guard & Sync ---

  loadCloudSyncConfig() {
    if (!this.storage) {
      return { enabled: false, workerUrl: '', syncSecret: '', autoSync: true, lastSyncTime: null };
    }
    try {
      const raw = this.storage.getItem('bbsterm_monitor_cloud_sync');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: Boolean(parsed.enabled),
          workerUrl: String(parsed.workerUrl || '').trim(),
          syncSecret: String(parsed.syncSecret || '').trim(),
          autoSync: parsed.autoSync !== false,
          lastSyncTime: parsed.lastSyncTime || null,
        };
      }
    } catch (e) {
      console.warn('Failed to load Cloudflare sync config:', e);
    }
    return { enabled: false, workerUrl: '', syncSecret: '', autoSync: true, lastSyncTime: null };
  }

  saveCloudSyncConfig(config) {
    this.cloudSyncConfig = {
      enabled: Boolean(config.enabled),
      workerUrl: String(config.workerUrl || '').trim().replace(/\/+$/, ''),
      syncSecret: String(config.syncSecret || '').trim(),
      autoSync: config.autoSync !== false,
      lastSyncTime: config.lastSyncTime || this.cloudSyncConfig?.lastSyncTime || null,
    };
    if (this.storage) {
      try {
        this.storage.setItem('bbsterm_monitor_cloud_sync', JSON.stringify(this.cloudSyncConfig));
      } catch (e) {
        console.warn('Failed to save Cloudflare sync config:', e);
      }
    }
    this.notify();
  }

  getCloudSyncConfig() {
    return { ...this.cloudSyncConfig };
  }

  async syncToCloud(options = {}) {
    if (this.customCloudSync) {
      return this.customCloudSync(options, {
        rules: this.getRules(),
        telegram: this.getTelegramConfig(),
      });
    }

    const workerUrl = (options.workerUrl || this.cloudSyncConfig?.workerUrl || '').trim().replace(/\/+$/, '');
    const syncSecret = (options.syncSecret || this.cloudSyncConfig?.syncSecret || '').trim();

    if (!workerUrl) {
      return { success: false, message: '請填寫 Cloudflare Worker 專屬網址' };
    }
    if (!syncSecret) {
      return { success: false, message: '請填寫同步密鑰 (Sync Secret Key)' };
    }

    const payload = JSON.stringify({
      rules: this.getRules(),
      telegram: this.getTelegramConfig(),
    });

    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
      try {
        const res = await window.__TAURI__.core.invoke('sync_to_cloudflare_worker', {
          workerUrl,
          secretKey: syncSecret,
          payloadJson: payload,
        });
        if (res.success) {
          this.cloudSyncConfig.lastSyncTime = res.updated_at || Date.now();
          this.saveCloudSyncConfig(this.cloudSyncConfig);
        }
        return res;
      } catch (e) {
        return { success: false, message: `同步失敗: ${e}` };
      }
    }

    // Web fallback
    try {
      const endpoint = workerUrl.endsWith('/sync') ? workerUrl : `${workerUrl}/sync`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncSecret}`,
        },
        body: payload,
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        this.cloudSyncConfig.lastSyncTime = data.updatedAt || Date.now();
        this.saveCloudSyncConfig(this.cloudSyncConfig);
        return data;
      }
      return { success: false, message: data.message || `HTTP ${resp.status}` };
    } catch (e) {
      return { success: false, message: `無法連線至 Worker: ${e.message}` };
    }
  }

  async testCloudConnection(workerUrl, syncSecret) {
    const cleanUrl = String(workerUrl || '').trim().replace(/\/+$/, '');
    const cleanSecret = String(syncSecret || '').trim();

    if (!cleanUrl) {
      return { success: false, message: '請填寫 Cloudflare Worker 網址' };
    }
    if (!cleanSecret) {
      return { success: false, message: '請填寫同步密鑰 (Sync Secret Key)' };
    }

    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke('test_cloudflare_worker', {
          workerUrl: cleanUrl,
          secretKey: cleanSecret,
        });
      } catch (e) {
        return { success: false, message: String(e) };
      }
    }

    try {
      const endpoint = cleanUrl.endsWith('/sync') ? cleanUrl : `${cleanUrl}/sync`;
      const resp = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanSecret}`,
        },
      });
      if (resp.ok) {
        return { success: true, message: '連線成功！Cloudflare Worker 運作正常且金鑰驗證通過。' };
      }
      if (resp.status === 401) {
        return { success: false, message: '連線失敗：同步密鑰 (Secret Key) 不正確。' };
      }
      return { success: false, message: `連線失敗 (HTTP ${resp.status})` };
    } catch (e) {
      return { success: false, message: `連線失敗: ${e.message}` };
    }
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
    if (!item || !item.link) return;
    const strLink = String(item.link);
    const strId = String(item.id || '');
    if (strLink.includes('cdn-cgi') || strId.startsWith('content?')) return;
    if (item.title === '批踢踢實業坊' && (!item.author || item.author === '-')) return;

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
      if (!article.id || String(article.id).startsWith('content?')) continue;
      if (String(article.link || '').includes('cdn-cgi')) continue;
      if (article.title === '批踢踢實業坊' && (!article.author || article.author === '-')) continue;

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
