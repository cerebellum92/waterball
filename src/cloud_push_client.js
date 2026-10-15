import { readBoundedBody } from '../shared/worker-http.js';
import { checkedCloudConfig, rulesSignature } from './cloud_restore.js';

export function normalizePushServiceUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new Error('請填寫合法的推播伺服器網址'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('推播伺服器必須使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('推播網址不可包含帳密或查詢參數');
  return url.href.replace(/\/+$/, '').replace(/\/sync$/, '');
}
const requestId = () => globalThis.crypto?.randomUUID?.() || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

/** One in-flight operation, coalesced config snapshots, durable offline pause intent. */
export class CloudPushClient {
  constructor(manager) { this.manager = manager; this.queue = []; this.running = false; }
  dirty() {
    const m = this.manager;
    m.saveCloudSyncConfig({ ...m.cloudSyncConfig, dirty: true, dirtySeq: (m.cloudSyncConfig.dirtySeq || 0) + 1 });
  }
  sync(options = {}) {
    const m = this.manager;
    const payload = { rules: m.getRules().filter(r => r.enabled), telegram: m.getTelegramConfig(), ...(options.sendTestPush ? { sendTestPush: true } : {}) };
    if (options.enabled !== undefined) payload.telegram.enabled = Boolean(options.enabled);
    if (options.chatId !== undefined) payload.telegram.chatId = String(options.chatId).trim();
    const action = options.lifecycleAction;
    if (options.userInitiated) m.saveCloudSyncConfig({ ...m.cloudSyncConfig, conflict: false });
    if (action) { if (m.cloudSyncConfig.pendingAction !== action) this.dirty(); m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingAction: action === 'pause' ? 'pause' : null }); }
    return new Promise(resolve => {
      const entry = { serviceId: m.cloudSyncConfig.serviceId, bindingVersion: m.cloudSyncConfig.bindingVersion, options, payload, action, seq: m.cloudSyncConfig.dirtySeq || 0, service: options.workerUrl || m.cloudSyncConfig.workerUrl, resolvers: [resolve] };
      const tail = this.queue.at(-1);
      const autoMerge = options.operation === 'merge' && !options.userInitiated && tail?.options.operation === 'merge' && !tail.options.userInitiated;
      if ((autoMerge || ((m.customCloudSync || m.cloudSyncConfig.serverMode === 'selfHosted') && !options.operation)) && !action && !options.testOnly && !options.sendTestPush && tail && !tail.action && !tail.options.testOnly && !tail.options.sendTestPush && tail.service === entry.service) { entry.resolvers.unshift(...tail.resolvers); this.queue[this.queue.length - 1] = entry; }
      else this.queue.push(entry);
      this.drain();
    });
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const entry = this.queue.shift();
        let result;
        try { result = await this.perform(entry); }
        catch (e) { result = { success: false, message: `無法同步：${e.message}` }; }
        if (result?.success !== true && entry.service === this.manager.cloudSyncConfig.workerUrl) this.manager.saveCloudSyncConfig({ ...this.manager.cloudSyncConfig, lastError: result?.message || '同步失敗', dirty: true });
        for (const resolve of entry.resolvers) resolve(result);
      }
    } finally { this.running = false; }
  }
  async request(base, endpoint, method, token, payload) {
    const url = `${base}${endpoint}`;
    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke('cloud_push_request', { workerUrl: url, secretKey: token || '', method, payloadJson: payload ? JSON.stringify(payload) : null });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: controller.signal, redirect: 'error' });
      const data = response.body?.getReader
        ? JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 1024 * 1024)))
        : await response.json();
      return { ...data, success: response.ok && data?.success === true, httpStatus: response.status };
    } catch (e) { controller.abort(); throw e; }
    finally { clearTimeout(timer); }
  }
  adopt(result, base, seq) {
    const m = this.manager;
    if (normalizePushServiceUrl(m.cloudSyncConfig.workerUrl || base) !== base) return;
    m.saveCloudSyncConfig({ ...m.cloudSyncConfig, workerUrl: base, configRevision: result.configRevision, lifecycleVersion: result.lifecycleVersion, serverStatus: result.status, serverMode: result.mode || 'official', leaseExpiresAt: result.leaseExpiresAt, lastSyncTime: result.updated_at || Date.now(), pendingRequest: null, pendingAction: null, dirty: (m.cloudSyncConfig.dirtySeq || 0) !== seq, lastError: '' });
    if (m.cloudStorageError) result.warning = '雲端已確認，但本機儲存失敗；請釋出儲存空間並重新保存設定';
  }
  async perform(entry) {
    const m = this.manager, c = m.cloudSyncConfig;
    const base = normalizePushServiceUrl(entry.service);
    if (normalizePushServiceUrl(c.workerUrl || base) !== base) return { success: false, message: '服務已切換，已取消舊操作' };
    if ((entry.options.userInitiated || entry.options.operation === 'merge') && entry.serviceId && (entry.serviceId !== c.serviceId || entry.bindingVersion !== c.bindingVersion)) return { success: false, message: '服務綁定已變更，請重新確認後再操作' };
    if (c.serverMode === 'selfHosted' && entry.options.operation === 'rebind') return { success: false, message: '獨立自架模式不支援官方服務換綁' };
    if (m.customCloudSync || c.serverMode === 'selfHosted') return this.performLegacy(entry);
    if (entry.options.operation === 'merge' && !entry.options.userInitiated && !c.autoMerge) return { success: false, message: '自動同步已暫停，本機規則保留' };
    if (c.pendingRequest && !c.pendingRequest.protocolVersion) m.saveCloudSyncConfig({ ...c, pendingRequest: null, pendingAction: null });
    let token = c.credentialOrigin === base ? c.deviceToken : '';
    const supplied = entry.options.pairingCode || entry.options.syncSecret || c.syncSecret || entry.payload.telegram.chatId;
    if (m.retiredCredentials?.has(supplied) && m.retiredCredentials.get(supplied) !== base) return { success: false, message: '舊服務憑證不能送到新服務' };
    let paired = false;
    if (entry.options.operation === 'rebind') {
      if (!token || !entry.options.userInitiated) return { success: false, message: '必須先配對原服務，才能更換 Telegram' };
      const result = await this.request(base, '/v4/binding', 'POST', token, { protocolVersion: 4, bindingVersion: c.bindingVersion, pairingCode: entry.options.newPairingCode, confirmTransfer: true });
      if (!result.success) return this.failed(result);
      if (normalizePushServiceUrl(m.cloudSyncConfig.workerUrl) !== base) return { success: false, message: '換綁已完成，但目前服務已切換；請回原服務以新 Telegram 重新配對' };
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, deviceToken: result.token, syncSecret: result.token, pairedCode: '', credentialOrigin: base, serviceId: result.serviceId, bindingVersion: result.bindingVersion, pendingRequest: null, pendingAction: null, requiresPairing: false });
      if (m.cloudStorageError) return { success: true, warning: '換綁已完成，但新憑證無法儲存；請使用新 Telegram 配對碼重新配對' };
      return this.readOfficial(base, result.token, false);
    }
    if (token && typeof supplied === 'string' && supplied.startsWith('WB2-') && supplied !== c.pairedCode && entry.options.userInitiated) return { success: false, message: '已有服務憑證；更換 Telegram 請使用獨立換綁操作' };
    if (!token && typeof supplied === 'string' && supplied.startsWith('WB2-')) {
      if (!entry.options.userInitiated) return { success: false, message: '請手動完成 Telegram 配對' };
      const result = await this.request(base, '/pair', 'POST', '', { pairingCode: supplied });
      if (!result.success) return this.failed(result);
      if (normalizePushServiceUrl(m.cloudSyncConfig.workerUrl) !== base) return { success: false, message: '服務已切換，請重新配對' };
      token = result.token; paired = true;
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, autoMerge: false, mergeBlocked: null, deviceToken: token, syncSecret: token, pairedCode: supplied, credentialOrigin: base, serviceId: result.serviceId, bindingVersion: result.bindingVersion, configRevision: null, lifecycleVersion: null, remoteConfig: null, restorePending: false, pendingRequest: null, pendingAction: null, requiresPairing: false, needsCloudRead: true });
      if (!m.storage || m.cloudStorageError) throw new Error('無法保存裝置憑證，請檢查本機儲存空間');
    }
    if (!token) token = supplied;
    if (!token) return { success: false, message: '請先填入 Telegram 配對碼完成配對' };
    const remote = await this.request(base, '/sync', 'GET', token);
    if (normalizePushServiceUrl(m.cloudSyncConfig.workerUrl) !== base) return { success: false, message: '服務已切換，已取消舊操作' };
    if (!remote.success) return this.failed(remote);
    if (remote.config?.mode === 'selfHosted' || remote.mode === 'selfHosted') {
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, serverMode: 'selfHosted' });
      return this.performLegacy(entry);
    }
    if (remote.config?.protocolVersion !== 4) return { success: false, httpStatus: 426, message: '官方服務尚未更新，請先更新推播後端與 Worker' };
    if (entry.options.operation === 'merge' && !paired) return this.performMerge(entry, base, token, checkedCloudConfig(remote.config));
    const restoration = m.adoptCloudConfig(remote.config, { importRules: !entry.options.testOnly && (paired || entry.options.operation === 'read' || (!entry.options.userInitiated && !m.cloudSyncConfig.dirty)) });
    this.lastReadAttemptAt = Date.now();
    m.saveCloudSyncConfig({ ...m.cloudSyncConfig, needsCloudRead: false, lastCloudReadAt: this.lastReadAttemptAt });
    if (restoration.success === false) return restoration;
    if (paired || entry.options.operation === 'pair' || entry.options.operation === 'read' || !entry.options.userInitiated) return { success: true, mode: 'official', paired, message: restoration.message || '已讀取雲端設定；雲端規則未變更', ...restoration, config: m.cloudSyncConfig.remoteConfig };
    if (entry.options.testOnly) return this.failedIfNeeded(await this.request(base, '/notification-test', 'POST', token, {}));
    // Recover an ambiguous previous write by reading its receipt, never reposting old rules.
    const pending = m.cloudSyncConfig.pendingRequest;
    if (pending?.protocolVersion === 4) {
      const recovered = await this.request(base, '/v4/receipt', 'POST', token, { protocolVersion: 4, requestId: pending.payload.requestId });
      if (!recovered.success) return this.failed(recovered);
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null, pendingAction: null });
      if (recovered.receipt) return { success: true, mode: 'official', recovered: true, ...recovered.receipt, message: '前次操作已成功；請查看目前雲端設定，再決定是否重新套用' };
    }
    const action = entry.action;
    const payload = action
      ? { protocolVersion: 4, action, requestId: requestId(), lifecycleVersion: remote.config.lifecycleVersion }
      : { protocolVersion: 4, intent: 'replaceRules', requestId: requestId(), expiresAt: remote.config.serverTime + 5 * 60000, rules: entry.payload.rules, telegram: { silent: entry.payload.telegram.silent === true } };
    const endpoint = action ? '/lifecycle' : '/sync';
    m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: { protocolVersion: 4, origin: base, endpoint, payload, seq: entry.seq }, pendingAction: null });
    if (m.cloudStorageError && action !== 'pause') throw new Error('本機無法保存操作，尚未變更雲端');
    const result = await this.request(base, endpoint, 'POST', token, payload);
    if (!result.success) return this.failed(result);
    this.adopt(result, base, entry.seq);
    await this.readOfficial(base, token, false);
    return result;
  }
  failedIfNeeded(result) { return result.success ? result : this.failed(result); }
  async performMerge(entry, base, token, initialRemote) {
    const m = this.manager;
    if ((entry.options.bootstrapMerge || entry.options.resolution) && !entry.options.userInitiated) return { success: false, message: '首次合併及衝突選擇必須由使用者確認' };
    let remote = initialRemote;
    m.adoptCloudConfig(remote);
    const pending = m.cloudSyncConfig.pendingRequest;
    if (pending?.protocolVersion === 4) {
      const recovered = await this.request(base, '/v4/receipt', 'POST', token, { protocolVersion: 4, requestId: pending.payload.requestId });
      if (!recovered.success) return this.failed(recovered);
      if (recovered.receipt && pending.mergeContext) {
        const acknowledged = m.completeCloudMerge({ ...pending.mergeContext, rules: pending.payload.rules, silent: pending.payload.telegram.silent }, recovered.receipt.configRevision);
        if (acknowledged.warning || m.cloudSyncConfig.mergeBlocked) return { ...acknowledged, recovered: true };
      } else if (!recovered.receipt && !pending.mergeContext && pending.payload.expiresAt > remote.serverTime) {
        return { success: false, message: '前次手動取代操作尚未確認，請稍後重新合併，避免交錯覆寫' };
      }
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) {
        const fresh = await this.request(base, '/sync', 'GET', token);
        if (!fresh.success) return this.failed(fresh);
        remote = checkedCloudConfig(fresh.config); m.adoptCloudConfig(remote);
      }
      if (normalizePushServiceUrl(m.cloudSyncConfig.workerUrl) !== base || m.cloudSyncConfig.serviceId !== remote.serviceId || m.cloudSyncConfig.bindingVersion !== remote.bindingVersion) return { success: false, message: '服務綁定已變更，合併已取消' };
      if (!remote.syncCapabilities.includes('mergeRules')) {
        m.saveCloudSyncConfig({ ...m.cloudSyncConfig, mergeBlocked: '官方後端尚未支援安全合併，請先更新後端' });
        return { success: false, httpStatus: 426, message: '請先更新官方後端，才能使用安全合併同步' };
      }
      if (m.canAutoRestoreRules?.() === false) return { success: false, message: '請先儲存或取消正在編輯的規則，再合併同步' };
      const resolution = entry.options.resolution;
      const validResolution = resolution && resolution.plan.origin === base && resolution.plan.serviceId === remote.serviceId && resolution.plan.bindingVersion === remote.bindingVersion && resolution.plan.revision === remote.configRevision && resolution.plan.localSignature === rulesSignature(m.rules) && resolution.plan.localSilent === m.telegramConfig.silent && resolution.plan.remoteSignature === rulesSignature(remote.rules);
      let plan;
      try { plan = m.planCloudMerge(remote, { bootstrapMerge: entry.options.bootstrapMerge, ...(validResolution ? { choices: resolution.choices, selectedBoards: resolution.selectedBoards } : {}) }); }
      catch (e) { m.saveCloudSyncConfig({ ...m.cloudSyncConfig, mergeBlocked: e.message }); return { success: false, message: e.message }; }
      if (!plan) {
        m.saveCloudSyncConfig({ ...m.cloudSyncConfig, mergeBlocked: '尚無共同同步基準，請先還原或確認首次合併' });
        return { success: false, baselineRequired: true, message: '此裝置尚無共同基準；請先還原雲端規則，或確認保留兩邊規則作首次合併' };
      }
      if (plan.conflicts.length || plan.quotaExceeded || (resolution && !validResolution)) {
        const message = resolution && !validResolution ? '選擇期間設定已變更，請重新查看衝突' : plan.conflicts.length ? '同一筆規則有不同修改，請選擇保留本機或雲端欄位' : `合併後超過 ${plan.maxBoards} 板或 100 條生效規則，請選擇啟用看板或減少規則`;
        m.saveCloudSyncConfig({ ...m.cloudSyncConfig, mergeBlocked: message });
        return { success: false, mergeRequired: true, plan, message };
      }
      if (!plan.needsWrite) return m.completeCloudMerge(plan, remote.configRevision);
      const payload = { protocolVersion: 4, intent: 'mergeRules', baseRevision: remote.configRevision, requestId: requestId(), expiresAt: remote.serverTime + 5 * 60000, rules: plan.rules, telegram: { silent: plan.silent } };
      const mergeContext = { origin: base, serviceId: plan.serviceId, bindingVersion: plan.bindingVersion, localRules: plan.localRules.filter(r => r.enabled), localSilent: plan.localSilent, disabled: plan.disabled };
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, mergeBlocked: null, pendingRequest: { protocolVersion: 4, origin: base, endpoint: '/sync', payload, mergeContext }, dirty: true });
      if (m.cloudStorageError) throw new Error('無法保存離線同步操作，雲端尚未變更');
      const result = await this.request(base, '/sync', 'POST', token, payload);
      if (result.httpStatus === 409) { m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null }); continue; }
      if (!result.success) return this.failed(result);
      if (!Number.isSafeInteger(result.configRevision)) throw new Error('伺服器未回傳有效版本，請重新讀取確認');
      const acknowledged = m.completeCloudMerge(plan, result.configRevision);
      m.adoptCloudConfig({ ...remote, configRevision: result.configRevision, rules: plan.rules, telegram: { ...remote.telegram, silent: plan.silent }, status: result.status || remote.status });
      this.lastReadAttemptAt = Date.now();
      if (acknowledged.dirty && !m.cloudSyncConfig.mergeBlocked) this.scheduleMerge();
      return acknowledged;
    }
    m.saveCloudSyncConfig({ ...m.cloudSyncConfig, mergeBlocked: '其他裝置持續修改中，請稍後重新合併' });
    return { success: false, httpStatus: 409, message: '已重試三次；其他裝置持續修改中，本機草稿保留' };
  }
  async readOfficial(base, token, importRules) {
    const remote = await this.request(base, '/sync', 'GET', token);
    if (normalizePushServiceUrl(this.manager.cloudSyncConfig.workerUrl) !== base) return { success: false, message: '服務已切換，已取消舊回應' };
    if (!remote.success) return this.failed(remote);
    const restoration = this.manager.adoptCloudConfig(remote.config, { importRules });
    if (restoration.success === false) return restoration;
    return { success: true, mode: 'official', config: this.manager.cloudSyncConfig.remoteConfig, message: '已讀取目前雲端設定', ...restoration };
  }
  async performLegacy(entry) {
    const m = this.manager;
    if (m.cloudSyncConfig.conflict && !entry.options.userInitiated) return { success: false, httpStatus: 409, message: '雲端狀態有衝突，請明確重新確認並同步' };
    if (m.cloudSyncConfig.requiresPairing && !entry.options.userInitiated) return { success: false, httpStatus: 401, message: '憑證已失效，請重新配對或更正自架密鑰' };
    let base;
    try { base = normalizePushServiceUrl(entry.service); } catch (e) { return { success: false, message: e.message || '請填寫推播伺服器網址' }; }
    if (normalizePushServiceUrl(m.cloudSyncConfig.workerUrl || entry.service) !== base) return { success: false, message: '推播服務已切換，已取消舊操作' };
    let token = m.cloudSyncConfig.credentialOrigin === base ? m.cloudSyncConfig.deviceToken : '';
    token ||= entry.options.syncSecret !== undefined ? entry.options.syncSecret : m.cloudSyncConfig.syncSecret || entry.payload.telegram.chatId;
    if (entry.options.pairingCode?.startsWith('WB2-') && entry.options.pairingCode !== m.cloudSyncConfig.pairedCode) token = entry.options.pairingCode;
    if (!token) return { success: false, message: '請填寫同步密鑰或 Telegram 綁定碼' };
    if (m.retiredCredentials?.has(token) && m.retiredCredentials.get(token) !== base) return { success: false, message: '舊服務憑證不能送到新服務，請填入新的配對碼或自架密鑰' };
    const payload = { ...entry.payload, requestId: requestId(), baseRevision: m.cloudSyncConfig.configRevision || 0, lifecycleVersion: m.cloudSyncConfig.lifecycleVersion || 0, ...(entry.action ? { action: entry.action } : {}) };
    if (m.customCloudSync) {
      const result = await m.customCloudSync(entry.options, payload);
      if (result?.success === true && !entry.options.testOnly) this.adopt(result, base, entry.seq);
      return result;
    }
    if (token.startsWith('WB2-')) {
      const paired = await this.request(base, '/pair', 'POST', '', { pairingCode: token });
      if (paired.success !== true || typeof paired.token !== 'string' || !paired.token) return { success: false, message: paired.message || '配對失敗，請取得新的配對碼' };
      if (normalizePushServiceUrl(m.cloudSyncConfig.workerUrl || entry.service) !== base) return { success: false, message: '服務已切換，請重新配對' };
      const pairedCode = token;
      token = paired.token;
      // Persist before attempting configuration or test notifications.
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, deviceToken: token, syncSecret: token, credentialOrigin: base, pairedCode, configRevision: null, lifecycleVersion: null, requiresPairing: false });
      if (!m.storage || m.cloudStorageError) throw new Error('無法持久保存裝置憑證，尚未啟用雲端；請檢查本機儲存空間');
    }
    if (entry.options.testOnly) return this.request(base, '/notification-test', 'POST', token, {});
    let pending = m.cloudSyncConfig.pendingRequest;
    if (pending?.payload.action && pending.payload.action !== 'pause') {
      // A restored app may have been terminated during an unacknowledged resume.
      // Read actual state instead of replaying old foreground activity in background.
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null, configRevision: null, lifecycleVersion: null });
      pending = null;
    }
    if (pending?.origin === base) {
      const previous = await this.request(base, pending.endpoint || '/sync', 'POST', token, pending.payload);
      if (previous.success !== true) return this.failed(previous);
      this.adopt(previous, base, pending.seq);
      if (pending.payload.action === 'pause' && entry.action === 'pause') return previous;
      if (JSON.stringify(pending.payload.rules) === JSON.stringify(entry.payload.rules) && JSON.stringify(pending.payload.telegram) === JSON.stringify(entry.payload.telegram) && pending.payload.action === entry.action) return previous;
    }
    if (!Number.isInteger(m.cloudSyncConfig.configRevision) || !Number.isInteger(m.cloudSyncConfig.lifecycleVersion)) {
      const remote = await this.request(base, '/sync', 'GET', token);
      if (remote.success !== true) return this.failed(remote);
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, configRevision: remote.config?.configRevision || 0, lifecycleVersion: remote.config?.lifecycleVersion || 0, credentialOrigin: base, serverStatus: remote.config?.status || 'unpaired' });
    }
    payload.baseRevision = m.cloudSyncConfig.configRevision;
    payload.lifecycleVersion = m.cloudSyncConfig.lifecycleVersion;
    const endpoint = entry.action === 'pause' ? '/lifecycle' : '/sync';
    const finalPayload = entry.action === 'pause' ? { action: 'pause', requestId: payload.requestId, lifecycleVersion: payload.lifecycleVersion } : payload;
    m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: { origin: base, endpoint, payload: finalPayload, seq: entry.seq }, dirty: true });
    if (m.cloudStorageError && entry.action !== 'pause') throw new Error('本機無法保存同步操作，請檢查儲存空間後再試');
    try {
      const result = await this.request(base, endpoint, 'POST', token, finalPayload);
      if (result.success !== true) return this.failed(result);
      this.adopt(result, base, entry.seq);
      return result;
    } catch (e) {
      // Resume/renew must never be replayed later as an offline activity signal.
      const retry = entry.action && entry.action !== 'pause' ? null : m.cloudSyncConfig.pendingRequest;
      m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: retry, dirty: true, lastError: e.message });
      return { success: false, message: entry.action === 'pause' ? '本機已關閉；雲端暫停待網路恢復後同步' : `無法連線至推播伺服器：${e.message}` };
    }
  }
  failed(result) {
    const m = this.manager;
    if (m.cloudSyncConfig.pendingRequest?.payload.action && m.cloudSyncConfig.pendingRequest.payload.action !== 'pause') m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null, pendingAction: null });
    if (result.httpStatus === 409) m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null, pendingAction: null, configRevision: null, lifecycleVersion: null, conflict: true, dirty: true });
    else if (result.httpStatus === 401) m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null, pendingAction: null, deviceToken: '', syncSecret: '', requiresPairing: true, dirty: true });
    else if (result.httpStatus >= 400 && result.httpStatus < 500) m.saveCloudSyncConfig({ ...m.cloudSyncConfig, pendingRequest: null, dirty: true });
    m.saveCloudSyncConfig({ ...m.cloudSyncConfig, lastError: result.message || '同步失敗' });
    return result;
  }
  retry() {
    const c = this.manager.cloudSyncConfig;
    if (!this.manager.customCloudSync && c.serverMode !== 'selfHosted') {
      if (c.needsCloudRead) return this.refreshOfficial();
      if (c.autoMerge && c.dirty && !c.mergeBlocked && c.deviceToken && !c.requiresPairing) return this.sync({ operation: 'merge' });
      return;
    }
    if (c.conflict || c.requiresPairing || !c.dirty || !c.workerUrl || (!c.enabled && c.pendingAction !== 'pause')) return;
    return this.sync(c.pendingAction === 'pause' ? { lifecycleAction: 'pause' } : {});
  }
  refreshOfficial() {
    const c = this.manager.cloudSyncConfig;
    if (this.manager.customCloudSync || c.serverMode === 'selfHosted' || !c.workerUrl || !c.deviceToken || c.requiresPairing || this.running || Date.now() - (this.lastReadAttemptAt || 0) < 60000) return;
    this.lastReadAttemptAt = Date.now();
    return this.sync({ operation: c.autoMerge && !c.mergeBlocked && this.manager.getSyncBaseline() ? 'merge' : 'read' });
  }
  scheduleMerge() {
    clearTimeout(this.mergeTimer);
    const c = this.manager.cloudSyncConfig;
    if (this.manager.customCloudSync || c.serverMode !== 'official' || !c.autoMerge || !c.deviceToken || c.requiresPairing || c.mergeBlocked) return;
    this.mergeTimer = setTimeout(() => { this.mergeTimer = null; this.retry()?.catch(() => {}); }, 600);
  }
}
