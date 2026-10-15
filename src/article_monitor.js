// Local PTT Article Monitor & Push Notification Engine for Waterball BBS

import { sendNativeNotification } from './platform.js';
import { CloudPushClient, normalizePushServiceUrl } from './cloud_push_client.js';
import { checkedCloudConfig, restorePreview, rulesSignature } from './cloud_restore.js';
import { makeMergePlan, mergeRules, mergeSilent, withLocalBackups } from './cloud_merge.js';

export const MAX_MONITOR_BOARDS = 10;
export const DEFAULT_OFFICIAL_WORKER_URL = 'https://waterball-tracker.cerebellum92.workers.dev';

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
    this.localNotifEnabled = this.loadLocalNotifConfig();
    this.telegramConfig = this.loadTelegramConfig();
    this.cloudSyncConfig = this.loadCloudSyncConfig();
    this.cloudClient = new CloudPushClient(this);
    this.initializedBoards = new Set();
    this.intervalMinutes = 3;
    this.timer = null;
    this.isChecking = false;
    this.lastCheckedTime = 0;
    this.lastError = '';
    this.listeners = [];
    this.onNewAlert = null;
  }

  loadLocalNotifConfig() {
    if (!this.storage) return true;
    try {
      const raw = this.storage.getItem('bbsterm_monitor_local_notif');
      if (raw !== null && raw !== undefined) {
        return JSON.parse(raw) !== false;
      }
    } catch (_) {}
    return true;
  }

  setLocalNotifEnabled(enabled) {
    this.localNotifEnabled = Boolean(enabled);
    if (this.storage) {
      try {
        this.storage.setItem('bbsterm_monitor_local_notif', JSON.stringify(this.localNotifEnabled));
      } catch (_) {}
    }
    this.notify();
  }

  isLocalNotifEnabled() {
    return this.localNotifEnabled !== false;
  }

  loadRules() {
    if (!this.storage) return structuredClone(DEFAULT_MONITOR_RULES);
    try {
      const raw = this.storage.getItem('bbsterm_monitor_rules');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed?.formatVersion === 1 && Array.isArray(parsed.rules)) {
          this.restoreBackup = Array.isArray(parsed.backup) ? parsed.backup : null;
          this.restoreSource = parsed.source || null;
          return parsed.rules;
        }
      }
    } catch (e) {
      console.warn('Failed to load monitor rules:', e);
    }
    return structuredClone(DEFAULT_MONITOR_RULES);
  }

  saveRules() {
    if (!this.storage) return;
    try {
      this.storage.setItem('bbsterm_monitor_rules', JSON.stringify(this.restoreSource || this.restoreBackup !== undefined
        ? { formatVersion: 1, rules: this.rules, backup: this.restoreBackup || null, source: this.restoreSource || null }
        : this.rules));
    } catch (e) {
      console.warn('Failed to save monitor rules:', e);
    }
    this.cloudClient.dirty();
    this.notify();
    if (this.cloudSyncConfig?.enabled && this.cloudSyncConfig?.autoSync && this.cloudSyncConfig?.workerUrl && (this.customCloudSync || this.cloudSyncConfig.serverMode === 'selfHosted')) {
      this.syncToCloud().catch(() => {});
    }
    this.cloudClient.scheduleMerge();
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
      this.seenIds = new Set(arr);
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

  saveTelegramConfig(config, { sync = true, markDirty = true } = {}) {
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
    if (markDirty) this.cloudClient.dirty();
    this.notify();
    if (sync && this.cloudSyncConfig?.enabled && this.cloudSyncConfig?.autoSync && this.cloudSyncConfig?.workerUrl && (this.customCloudSync || this.cloudSyncConfig.serverMode === 'selfHosted')) {
      this.syncToCloud().catch(() => {});
    }
    if (markDirty && sync) this.cloudClient.scheduleMerge();
  }

  getTelegramConfig() {
    return { ...this.telegramConfig };
  }

  async sendTelegramRawMessage(botToken, chatId, text, silent = false, buttonUrl = null, buttonText = null) {
    if (this.customTelegramSend) {
      return this.customTelegramSend(botToken, chatId, text, silent, buttonUrl, buttonText);
    }
    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke('send_telegram_message', {
          botToken,
          chatId,
          text,
          silent: Boolean(silent),
          buttonUrl: buttonUrl || null,
          buttonText: buttonText || null,
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
    // Cloud deployments own Telegram delivery; local OS alerts can still run.
    if (this.cloudSyncConfig?.enabled && this.cloudSyncConfig?.workerUrl) return null;
    const { botToken, chatId, silent } = this.telegramConfig;
    if (!botToken || !chatId) return null;

    const link = normalizePttArticleUrl(alertItem.link, alertItem.board);
    const text = formatTelegramArticleMessage(alertItem);
    return this.sendTelegramRawMessage(botToken, chatId, text, silent, link, '📖 開啟 PTT 好讀版');
  }

  async testTelegram(botToken, chatId, workerUrlOverride = '') {
    const cleanToken = normalizeTelegramBotToken(botToken);
    const cleanChatId = String(chatId || '').trim();
    if (!cleanChatId) {
      return { success: false, message: '請先填寫您的 Telegram 專屬推播綁定碼 (Chat ID)' };
    }

    // Mode 1: Official Bot mode (no personal botToken required — sends via official push server)
    if (!cleanToken || (this.cloudSyncConfig?.enabled && this.cloudSyncConfig?.workerUrl)) {
      const targetUrl = String(
        workerUrlOverride || this.cloudSyncConfig?.workerUrl || DEFAULT_OFFICIAL_WORKER_URL
      ).trim();
      const syncSecret = this.cloudSyncConfig?.syncSecret || cleanChatId;
      return this.syncToCloud({
        workerUrl: targetUrl,
        syncSecret,
        chatId: cleanChatId,
        sendTestPush: true,
        testOnly: true,
        userInitiated: true,
      });
    }

    // Mode 2: Custom Bot Token mode
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
      `🔔 您的 Telegram 推播已設定完成。監測到符合條件的 PTT 新文章時，將會即時發送私訊通知至此處。`,
    ].join('\n');

    return this.sendTelegramRawMessage(cleanToken, cleanChatId, testText, false);
  }

  // --- Cloudflare / Official Push Server 24H Sync ---

  loadCloudSyncConfig() {
    if (!this.storage) {
      return { enabled: false, workerUrl: '', syncSecret: '', deviceToken: '', autoSync: true, botUsername: 'WaterballAlertBot', lastSyncTime: null };
    }
    try {
      const raw = this.storage.getItem('bbsterm_monitor_cloud_sync');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...parsed,
          credentialOrigin: parsed.credentialOrigin || (parsed.deviceToken && parsed.workerUrl ? normalizePushServiceUrl(parsed.workerUrl) : ''),
          enabled: Boolean(parsed.enabled),
          workerUrl: String(parsed.workerUrl || '').trim(),
          syncSecret: String(parsed.syncSecret || '').trim(),
          deviceToken: String(parsed.deviceToken || '').trim(),
          autoSync: parsed.autoSync !== false,
          autoMerge: parsed.autoMerge === true,
          botUsername: String(parsed.botUsername || 'WaterballAlertBot').trim().replace(/^@/, ''),
          lastSyncTime: parsed.lastSyncTime || null,
        };
      }
    } catch (e) {
      console.warn('Failed to load Cloudflare sync config:', e);
    }
    return { enabled: false, workerUrl: '', syncSecret: '', deviceToken: '', autoSync: true, botUsername: 'WaterballAlertBot', lastSyncTime: null };
  }

  saveCloudSyncConfig(config) {
    const old = this.cloudSyncConfig || {};
    if (config.workerUrl && old.workerUrl) {
      try {
        if (normalizePushServiceUrl(config.workerUrl) !== normalizePushServiceUrl(old.workerUrl)) {
          this.retiredCredentials ||= new Map();
          for (const token of [old.deviceToken, old.syncSecret]) if (token && !this.retiredCredentials.has(token)) this.retiredCredentials.set(token, normalizePushServiceUrl(old.workerUrl));
          while (this.retiredCredentials.size > 10) this.retiredCredentials.delete(this.retiredCredentials.keys().next().value);
          config = { ...config, deviceToken: '', credentialOrigin: '', pairedCode: '', configRevision: null, lifecycleVersion: null, pendingRequest: null, pendingAction: null, serviceId: null, bindingVersion: null, remoteConfig: null, serverMode: null, serverStatus: null, conflict: false, requiresPairing: false, restorePending: false, needsCloudRead: false, lastCloudReadAt: null, autoMerge: false, mergeBlocked: null,
            syncSecret: config.syncSecret === old.syncSecret ? '' : config.syncSecret || '' };
        }
      } catch { config = { ...config, deviceToken: '', syncSecret: '', credentialOrigin: '' }; }
    }
    if (config.syncSecret && this.retiredCredentials?.has(config.syncSecret)) {
      try { if (this.retiredCredentials.get(config.syncSecret) !== normalizePushServiceUrl(config.workerUrl || old.workerUrl)) config = { ...config, syncSecret: '' }; }
      catch { config = { ...config, syncSecret: '' }; }
    }
    this.cloudSyncConfig = {
      ...old,
      ...config,
      enabled: Boolean(config.enabled),
      workerUrl: String(config.workerUrl !== undefined ? config.workerUrl : (this.cloudSyncConfig?.workerUrl || '')).trim().replace(/\/+$/, ''),
      syncSecret: String(config.syncSecret !== undefined ? config.syncSecret : (this.cloudSyncConfig?.syncSecret || '')).trim(),
      deviceToken: String(config.deviceToken !== undefined ? config.deviceToken : (this.cloudSyncConfig?.deviceToken || '')).trim(),
      autoSync: config.autoSync !== false,
      autoMerge: (config.autoMerge !== undefined ? config.autoMerge : old.autoMerge) === true,
      botUsername: String(config.botUsername || this.cloudSyncConfig?.botUsername || 'WaterballAlertBot').trim().replace(/^@/, ''),
      lastSyncTime: config.lastSyncTime || this.cloudSyncConfig?.lastSyncTime || null,
    };
    if (this.storage) {
      try {
        this.storage.setItem('bbsterm_monitor_cloud_sync', JSON.stringify(this.cloudSyncConfig));
        this.cloudStorageError = '';
      } catch (e) {
        this.cloudStorageError = e.message || '本機儲存失敗';
        console.warn('Failed to save Cloudflare sync config:', e);
      }
    }
    this.notify();
  }

  getCloudSyncConfig() {
    return { ...this.cloudSyncConfig };
  }

  hasLocalRuleDraft() {
    const signature = rulesSignature(this.rules), c = this.cloudSyncConfig;
    let origin;
    try { origin = normalizePushServiceUrl(c.workerUrl); } catch { origin = ''; }
    if (this.restoreSource?.origin === origin && this.restoreSource.serviceId === c.serviceId) return signature !== this.restoreSource.signature;
    if (signature === rulesSignature(DEFAULT_MONITOR_RULES)) return false;
    return !c.remoteConfig || signature !== rulesSignature(c.remoteConfig.rules) || Boolean(c.dirty);
  }

  getCloudRestorePreview() {
    const c = this.cloudSyncConfig;
    if (!c.remoteConfig || c.remoteConfig.configRevision === 0) return null;
    return restorePreview(this.rules, c.remoteConfig, normalizePushServiceUrl(c.workerUrl));
  }

  getLocalRulesBackup() {
    return this.restoreBackup !== undefined ? this.restoreBackup : this.cloudSyncConfig.savedLocalRules;
  }

  // One atomic localStorage value contains both the restored rules and the old copy.
  // Configuration metadata can fail separately without losing either rule collection.
  persistRestoredRules(rules, backup, source) {
    if (!this.storage) throw new Error('無法保存還原設定，本機規則保持不變');
    const changed = rulesSignature(this.rules) !== rulesSignature(rules);
    this.storage.setItem('bbsterm_monitor_rules', JSON.stringify({ formatVersion: 1, rules, backup, source }));
    this.rules = structuredClone(rules); this.restoreBackup = structuredClone(backup); this.restoreSource = source;
    if (changed) this.initializedBoards.clear();
  }

  applyCloudRestore(preview, { fromRead = false } = {}) {
    try {
      const c = this.cloudSyncConfig, remote = checkedCloudConfig(c.remoteConfig);
      if ((!fromRead && this.cloudClient.running) || c.pendingRequest) return { success: false, message: '同步操作仍在執行或等待確認，請先確認結果，再還原本機規則' };
      if (!preview || preview.origin !== normalizePushServiceUrl(c.workerUrl) || preview.serviceId !== c.serviceId ||
          preview.bindingVersion !== c.bindingVersion || preview.configRevision !== remote.configRevision ||
          preview.cloudSignature !== rulesSignature(remote.rules) || preview.localSignature !== rulesSignature(this.rules)) {
        return { success: false, message: '本機或雲端設定已變更，請重新查看還原預覽；規則尚未替換' };
      }
      const backup = this.hasLocalRuleDraft() || !this.getLocalRulesBackup() ? structuredClone(this.rules) : structuredClone(this.getLocalRulesBackup());
      this.persistRestoredRules(remote.rules, backup, { origin: preview.origin, serviceId: remote.serviceId, bindingVersion: remote.bindingVersion, revision: remote.configRevision, signature: rulesSignature(remote.rules), baseRules: structuredClone(remote.rules), baseSilent: remote.telegram.silent });
      this.saveCloudSyncConfig({ ...c, restorePending: false, dirty: false, savedLocalRules: null, mergeBlocked: null, lastError: '' });
      const warning = this.cloudStorageError ? '規則與備份已保存，但同步狀態保存失敗；請檢查本機儲存空間' : undefined;
      this.saveTelegramConfig({ ...this.telegramConfig, silent: remote.telegram.silent }, { sync: false, markDirty: false });
      return { success: true, restored: true, warning, message: '已將雲端規則還原到此裝置，原本規則保留於本機備份；雲端未變更' };
    } catch (e) { return { success: false, message: `還原失敗：${e.message}` }; }
  }

  adoptCloudConfig(raw, { importRules = false } = {}) {
    const remote = checkedCloudConfig(raw), c = this.cloudSyncConfig;
    if ((c.serviceId && c.serviceId !== remote.serviceId) || (c.bindingVersion && c.bindingVersion !== remote.bindingVersion)) throw new Error('雲端服務身份已變更，請重新配對；本機規則保持不變');
    const draft = this.hasLocalRuleDraft() || this.canAutoRestoreRules?.() === false;
    this.saveCloudSyncConfig({ ...c, serverMode: 'official', serviceId: remote.serviceId, bindingVersion: remote.bindingVersion, configRevision: remote.configRevision, lifecycleVersion: remote.lifecycleVersion, serverStatus: remote.status, leaseExpiresAt: remote.leaseExpiresAt, remoteConfig: remote, lastError: '', requiresPairing: false });
    this.saveTelegramConfig({ ...this.telegramConfig, enabled: remote.status === 'active', chatId: remote.telegram.chatId, silent: c.dirty ? this.telegramConfig.silent : remote.telegram.silent, botToken: '' }, { sync: false, markDirty: false });
    if (!importRules || remote.configRevision === 0) return { restored: false };
    if (draft) {
      const differs = rulesSignature(this.rules) !== rulesSignature(remote.rules);
      this.saveCloudSyncConfig({ ...this.cloudSyncConfig, restorePending: differs });
      return { restored: false, restoreRequired: differs, message: differs ? '雲端設定已下載；本機已有規則，請預覽後選擇是否還原' : '雲端與本機規則相同，本機草稿保留' };
    }
    return this.applyCloudRestore(this.getCloudRestorePreview(), { fromRead: true });
  }

  restoreCloudDraft() {
    if (this.cloudClient.running || this.cloudSyncConfig.pendingRequest) return { success: false, message: '請先等待同步結果確認，再取回本機備份' };
    const backup = this.getLocalRulesBackup();
    if (!Array.isArray(backup)) return { success: false, message: '沒有可取回的本機規則備份' };
    try {
      this.persistRestoredRules(backup, null, this.restoreSource || null);
      this.saveCloudSyncConfig({ ...this.cloudSyncConfig, savedLocalRules: null, autoMerge: false });
      this.cloudClient.dirty(); this.notify();
      return { success: true, message: '已取回本機規則備份，自動同步已暫停；雲端未變更' };
    } catch (e) { return { success: false, message: `取回失敗：${e.message}；備份仍保留` }; }
  }

  getSyncBaseline() {
    const c = this.cloudSyncConfig, source = this.restoreSource;
    if (!source || source.origin !== normalizePushServiceUrl(c.workerUrl) || source.serviceId !== c.serviceId || source.bindingVersion !== c.bindingVersion) return null;
    // Phase 1 stored the canonical rule JSON as a signature. It is an exact baseline,
    // not the subsequently refreshed remoteConfig, which may contain newer edits.
    try {
      if (typeof source.baseSilent !== 'boolean' && c.remoteConfig?.configRevision !== source.revision) return null;
      return { rules: structuredClone(source.baseRules || JSON.parse(source.signature)), silent: source.baseSilent ?? c.remoteConfig.telegram.silent, revision: source.revision };
    } catch { return null; }
  }

  planCloudMerge(remote, { bootstrapMerge = false, choices = {}, selectedBoards } = {}) {
    const c = this.cloudSyncConfig, cloud = checkedCloudConfig(remote);
    let baseline = this.getSyncBaseline();
    if (!baseline && (cloud.configRevision === 0 || bootstrapMerge)) baseline = { rules: [], silent: cloud.telegram.silent, revision: 0 };
    if (!baseline) return null;
    return makeMergePlan(baseline, this.rules, this.telegramConfig.silent, cloud, normalizePushServiceUrl(c.workerUrl), choices, selectedBoards);
  }

  completeCloudMerge(plan, revision) {
    const c = this.cloudSyncConfig;
    if (normalizePushServiceUrl(c.workerUrl) !== plan.origin || c.serviceId !== plan.serviceId || c.bindingVersion !== plan.bindingVersion) throw new Error('服務綁定已變更，未套用舊合併結果');
    const current = structuredClone(this.rules), currentSilent = this.telegramConfig.silent;
    const rebased = mergeRules(plan.localRules, current, plan.rules);
    const silent = mergeSilent(plan.localSilent, currentSilent, plan.silent);
    if (rebased.conflicts.length || silent.conflicts.length) {
      // Keep the old common baseline, so the next merge can identify both edits.
      this.saveCloudSyncConfig({ ...c, pendingRequest: null, dirty: true, mergeBlocked: '合併送出後本機又修改了相同欄位，請重新處理衝突' });
      return { success: true, dirty: true, warning: '雲端已更新；較新的本機修改保留，請重新合併' };
    }
    const disabled = plan.disabled || [];
    const retained = withLocalBackups(rebased.rules, [...current.filter(r => !disabled.some(d => d.id === r.id)), ...disabled]);
    const expected = withLocalBackups(plan.rules, retained);
    this.persistRestoredRules(retained, this.getLocalRulesBackup() || current, {
      origin: plan.origin, serviceId: plan.serviceId, bindingVersion: plan.bindingVersion, revision,
      signature: rulesSignature(expected), baseRules: structuredClone(plan.rules), baseSilent: plan.silent,
    });
    this.saveTelegramConfig({ ...this.telegramConfig, silent: silent.value }, { sync: false, markDirty: false });
    const dirty = rulesSignature(rebased.rules) !== rulesSignature(plan.rules) || silent.value !== plan.silent;
    this.saveCloudSyncConfig({ ...this.cloudSyncConfig, pendingRequest: null, dirty, mergeBlocked: null, restorePending: false, lastSyncTime: Date.now(), lastError: '' });
    return { success: true, merged: true, dirty, warning: this.cloudStorageError ? '雲端已確認，但本機同步狀態無法保存' : undefined, message: dirty ? '已合併；較新的本機修改仍待同步' : '本機與雲端規則已合併同步' };
  }
  syncToCloud(options = {}) {
    return this.cloudClient.sync(options);
  }

  async testCloudConnection(workerUrl, syncSecret) {
    try {
      const base = normalizePushServiceUrl(workerUrl);
      const current = this.cloudSyncConfig?.workerUrl ? normalizePushServiceUrl(this.cloudSyncConfig.workerUrl) : '';
      let token = String(syncSecret || this.cloudSyncConfig.syncSecret || this.telegramConfig.chatId || '').trim();
      if (current && current !== base && [this.cloudSyncConfig.deviceToken, this.cloudSyncConfig.syncSecret, this.telegramConfig.chatId].filter(Boolean).includes(token)) return { success: false, message: '請先保存新的服務設定，不能把舊服務憑證送到其他網址' };
      if (base === current && this.cloudSyncConfig.deviceToken) token = this.cloudSyncConfig.deviceToken;
      if (!token) return { success: false, message: '請填寫同步密鑰或先完成配對' };
      if (token.startsWith('WB2-')) return { success: false, message: '請先儲存並兌換配對碼，再測試連線' };
      const response = await this.cloudClient.request(base, '/sync', 'GET', token);
      if (response.success === true && Object.hasOwn(response, 'config')) return { success: true, message: '連線與身份驗證成功' };
      return { success: false, message: response.message || `連線失敗 (HTTP ${response.httpStatus})` };
    } catch (e) { return { success: false, message: `連線失敗：${e.message}` }; }
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

  getSubscribedBoards() {
    const boards = new Set();
    for (const r of this.rules) {
      if (!r.enabled) continue;
      const b = String(r.board || '').trim().toLowerCase();
      if (b) boards.add(b);
    }
    return Array.from(boards);
  }

  addRule({ board, keywords = [], author = '', minPushes = 0, enabled = true }) {
    const cleanBoard = String(board || '').trim();
    if (!cleanBoard) return null;

    const enabledBoards = new Set(this.getSubscribedBoards());
    let finalEnabled = enabled !== false;
    this.lastError = '';
    this.lastWarning = '';

    if (
      finalEnabled &&
      !enabledBoards.has(cleanBoard.toLowerCase()) &&
      enabledBoards.size >= MAX_MONITOR_BOARDS
    ) {
      finalEnabled = false;
      this.lastWarning = `已新增 [${cleanBoard}] 規則（目前已勾選滿 ${MAX_MONITOR_BOARDS} 個看板，此規則預設為未勾選）`;
    }

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
      enabled: finalEnabled,
    };

    this.rules.push(newRule);
    this.saveRules();

    // Trigger an immediate check for this new rule's board to establish baseline if enabled
    if (newRule.enabled) {
      this.checkBoard(newRule.board).catch(() => {});
    }
    return newRule;
  }

  updateRule(id, updates) {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;

    this.lastError = '';
    this.lastWarning = '';

    if (updates.board !== undefined) {
      updates.board = String(updates.board).trim();
    }

    const targetBoard = String(updates.board ?? this.rules[idx].board ?? '').trim();
    const willBeEnabled =
      updates.enabled !== undefined ? Boolean(updates.enabled) : Boolean(this.rules[idx].enabled);

    if (willBeEnabled && targetBoard) {
      const otherEnabledBoards = new Set(
        this.rules
          .filter((r) => r.id !== id && r.enabled)
          .map((r) => String(r.board || '').trim().toLowerCase())
          .filter(Boolean)
      );
      if (
        !otherEnabledBoards.has(targetBoard.toLowerCase()) &&
        otherEnabledBoards.size >= MAX_MONITOR_BOARDS
      ) {
        updates.enabled = false;
        this.lastWarning = `已更新 [${targetBoard}] 規則（目前已勾選滿 ${MAX_MONITOR_BOARDS} 個看板，此規則已設為未勾選）`;
      }
    }

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
    if (!rule) return false;

    if (!rule.enabled) {
      const enabledBoards = new Set(this.getSubscribedBoards());
      const targetBoard = String(rule.board || '').trim().toLowerCase();
      if (targetBoard && !enabledBoards.has(targetBoard) && enabledBoards.size >= MAX_MONITOR_BOARDS) {
        this.lastError = `最多只能同時勾選訂閱 ${MAX_MONITOR_BOARDS} 個不同看板，請先取消勾選其他看板`;
        return false;
      }
    }

    this.lastError = '';
    rule.enabled = !rule.enabled;
    this.saveRules();
    if (rule.enabled) {
      this.checkBoard(rule.board).catch(() => {});
    }
    return true;
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
        const matchedRule = activeRules.find((rule) => this.matchesRule(article, rule));
        const pendingMinPushes =
          !matchedRule &&
          activeRules.some(
            (rule) =>
              rule.minPushes > 0 && this.matchesRule({ ...article, nrec: '爆' }, rule)
          );

        if (isFirstTime || !pendingMinPushes) {
          this.seenIds.add(article.id);
        }

        // Baseline protection: do not spam notifications on the first scan of a board
        if (!isFirstTime && matchedRule) {
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

          // Native desktop push notification (when local OS push is enabled)
          if (this.isLocalNotifEnabled()) {
            const notifTitle = `📢 [${alertItem.board}] 新文章通知`;
            const notifBody = `${alertItem.title} (${alertItem.author}${alertItem.nrec ? ` | ${alertItem.nrec}推` : ''})`;
            sendNativeNotification(notifTitle, notifBody, () => {
              this.onNewAlert?.(alertItem);
            }).catch(() => {});
          }

          // Forward to Telegram if enabled (when personal botToken is provided locally)
          this.sendTelegramAlert(alertItem).catch((e) => {
            console.warn('[ArticleMonitor] Telegram forward error:', e);
          });
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
    this.intervalMinutes = Number.isFinite(intervalMinutes) ? Math.max(3, intervalMinutes) : 3;

    // Initial check after 3 seconds
    setTimeout(() => {
      this.checkAll().catch(() => {});
    }, 3000);

    // Retry durable offline pause/config intents; automatic retries never renew leases.
    this.cloudClient.retry()?.catch(() => {});
    // Recurring interval
    this.timer = setInterval(() => {
      this.cloudClient.retry()?.catch(() => {});
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
