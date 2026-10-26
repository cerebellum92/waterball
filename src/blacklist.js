// Local filtering preferences. The legacy built-in list has no verified provenance.
export const BUILTIN_GREAT_TREASURE = [
  'idcc', 'slow', 'cctv5', 'waynewayne', 'kinki999', 'googles', 'dispptt',
  'kero2377', 'b108077', 'vovhsu', 'leoth', 'danny910', 'sony5566',
  'laputaca', 'orz44444', 'pttisshit', 'zxcv9109', 'hate5566', 'obov5566',
  'crazypal', 'gn01765288', 'bruce0204', 'zzzz8888', 'asdasd123', 'qweqwe123',
  'love5566', 'hero5566', 'jacky5566', 'tony5566', 'andy5566', 'david5566',
  'pushman', 'booman', 'spammer01', 'spammer02', 'praccount01', 'praccount02'
];
export const BLACKLIST_LIMITS = Object.freeze({ users: 5000, keywords: 1000, keywordLength: 256, importLength: 1024 * 1024 });
const STATE_KEY = 'bbsterm_blacklist_v2';
const DEFAULTS = Object.freeze({ enabled: true, mode: 'dim', enableGreatTreasure: false, enableKeywords: true, blockWaterball: true, blockPushNotification: true });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function normalizeBlacklistId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{1,11}$/.test(id) ? id : null;
}
function normalizeKeyword(value) {
  if (typeof value !== 'string') return null;
  const keyword = value.trim().toLowerCase();
  return keyword && keyword.length <= BLACKLIST_LIMITS.keywordLength && !/[\x00-\x1f\x7f]/.test(keyword) ? keyword : null;
}
function settingsFor(value, strict = false, base = DEFAULTS) {
  if (!record(value)) { if (strict) throw new Error('設定格式錯誤'); return { ...base }; }
  const result = { ...base };
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.hasOwn(value, key)) continue;
    const valid = key === 'mode' ? ['dim', 'mask', 'hide'].includes(value[key]) : typeof value[key] === 'boolean';
    if (!valid) { if (strict) throw new Error(`設定 ${key} 不合法`); continue; }
    result[key] = value[key];
  }
  return result;
}
function listFor(values, normalize, max, strict = false) {
  if (!Array.isArray(values) || (strict && values.length > max)) {
    if (strict) throw new Error('清單格式錯誤或超過數量上限');
    return new Set();
  }
  const result = new Set();
  for (const value of values) {
    const clean = normalize(value);
    if (!clean) { if (strict) throw new Error('清單包含不合法的帳號或關鍵字'); continue; }
    result.add(clean);
  }
  return result;
}
function parseText(text) {
  if (typeof text !== 'string' || text.length > BLACKLIST_LIMITS.importLength) throw new Error('匯入內容過大或格式錯誤');
  return text.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean);
}

export class BlacklistManager {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    const saved = this.read(STATE_KEY);
    this.settings = settingsFor(saved?.settings ?? this.read('bbsterm_blacklist_settings'));
    // Legacy builds enabled this unsourced list by default; require fresh opt-in on migration.
    if (!record(saved)) this.settings.enableGreatTreasure = false;
    this.customList = listFor(saved?.blacklist ?? this.read('bbsterm_blacklist') ?? [], normalizeBlacklistId, BLACKLIST_LIMITS.users);
    this.customKeywords = listFor(saved?.keywords ?? this.read('bbsterm_blacklist_keywords') ?? [], normalizeKeyword, BLACKLIST_LIMITS.keywords);
    this.allowedUsers = listFor(saved?.allowedUsers ?? [], normalizeBlacklistId, BLACKLIST_LIMITS.users);
    this.greatTreasureSet = new Set(BUILTIN_GREAT_TREASURE);
    this.listeners = [];
    this.revision = 0;
  }
  getLimitWarnings() {
    const warnings = [];
    if (this.customList.size > BLACKLIST_LIMITS.users) warnings.push(`帳號清單 ${this.customList.size} 筆超過新增上限 ${BLACKLIST_LIMITS.users} 筆`);
    if (this.customKeywords.size > BLACKLIST_LIMITS.keywords) warnings.push(`關鍵字清單 ${this.customKeywords.size} 筆超過新增上限 ${BLACKLIST_LIMITS.keywords} 筆`);
    if (this.allowedUsers.size > BLACKLIST_LIMITS.users) warnings.push('允許例外清單超過新增上限');
    return warnings;
  }
  read(key) {
    try { const raw = this.storage?.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  snapshot() {
    return { version: '2.0', settings: this.settings, blacklist: [...this.customList], keywords: [...this.customKeywords], allowedUsers: [...this.allowedUsers] };
  }
  // Persist one coherent document before exposing the new state to listeners.
  commit({ settings = this.settings, users = this.customList, keywords = this.customKeywords, allowed = this.allowedUsers } = {}) {
    const state = { version: '2.0', settings, blacklist: [...users], keywords: [...keywords], allowedUsers: [...allowed] };
    this.storage?.setItem(STATE_KEY, JSON.stringify(state));
    this.settings = settings; this.customList = users; this.customKeywords = keywords; this.allowedUsers = allowed;
    this.revision++;
    this.notifyChange();
  }
  saveSettings(value) { this.commit({ settings: settingsFor(value, true, this.settings) }); }
  saveCustomList() { this.commit(); }
  saveCustomKeywords() { this.commit(); }
  getMode() { return ['dim', 'mask', 'hide'].includes(this.settings.mode) ? this.settings.mode : 'dim'; }
  hasUserRule(value) {
    const id = normalizeBlacklistId(value);
    return Boolean(id && (this.customList.has(id) ||
      (this.settings.enableGreatTreasure && !this.allowedUsers.has(id) && this.greatTreasureSet.has(id))));
  }
  hasKeywordRule(value) { return this.customKeywords.has(normalizeKeyword(value)); }
  isBlacklisted(value) { return this.settings.enabled && this.hasUserRule(value); }
  add(value) {
    const id = normalizeBlacklistId(value);
    if (!id || this.customList.has(id) || this.customList.size >= BLACKLIST_LIMITS.users) return false;
    const users = new Set(this.customList); users.add(id);
    const allowed = new Set(this.allowedUsers); allowed.delete(id);
    this.commit({ users, allowed }); return true;
  }
  remove(value) {
    const id = normalizeBlacklistId(value);
    if (!id || !this.customList.has(id)) return false;
    const users = new Set(this.customList); users.delete(id);
    this.commit({ users }); return true;
  }
  toggle(value) {
    const id = normalizeBlacklistId(value);
    if (!id) throw new Error('帳號格式不合法');
    // Toggle membership even while filtering is disabled; allow exceptions to the built-in list.
    const blocked = this.hasUserRule(id);
    if (!blocked) {
      if (!this.add(id)) throw new Error('帳號清單已達上限');
      return true;
    }
    const users = new Set(this.customList); users.delete(id);
    const allowed = new Set(this.allowedUsers);
    if (this.greatTreasureSet.has(id)) {
      if (!allowed.has(id) && allowed.size >= BLACKLIST_LIMITS.users) throw new Error('允許清單已達上限');
      allowed.add(id);
    }
    this.commit({ users, allowed }); return false;
  }
  getCustomListArray() { return [...this.customList].sort(); }
  getGreatTreasureCount() { return this.greatTreasureSet.size; }
  clear() { if (this.customList.size) this.commit({ users: new Set() }); }
  isKeywordBlacklisted(text) {
    if (!this.settings.enabled || !this.settings.enableKeywords || !text) return null;
    const lower = String(text).toLowerCase();
    for (const keyword of this.customKeywords) if (lower.includes(keyword)) return keyword;
    return null;
  }
  addKeyword(value) {
    const keyword = normalizeKeyword(value);
    if (!keyword || this.customKeywords.has(keyword) || this.customKeywords.size >= BLACKLIST_LIMITS.keywords) return false;
    const keywords = new Set(this.customKeywords); keywords.add(keyword);
    this.commit({ keywords }); return true;
  }
  removeKeyword(value) {
    const keyword = normalizeKeyword(value);
    if (!keyword || !this.customKeywords.has(keyword)) return false;
    const keywords = new Set(this.customKeywords); keywords.delete(keyword);
    this.commit({ keywords }); return true;
  }
  toggleKeyword(value) {
    const keyword = normalizeKeyword(value);
    if (!keyword) throw new Error('關鍵字格式不合法');
    if (this.customKeywords.has(keyword)) { this.removeKeyword(keyword); return false; }
    if (!this.addKeyword(keyword)) throw new Error('關鍵字清單已達上限');
    return true;
  }
  getCustomKeywordsArray() { return [...this.customKeywords].sort(); }
  clearKeywords() { if (this.customKeywords.size) this.commit({ keywords: new Set() }); }
  importFromText(text) {
    const ids = parseText(text).filter(line => !line.startsWith('#') && !line.startsWith('//')).flatMap(line => line.split(/[,;\s]+/).filter(Boolean));
    const result = this.importFromJSON({ blacklist: ids });
    if (!result.success) throw new Error(result.error);
    return result.addedUsers;
  }
  importKeywordsFromText(text) {
    // One literal keyword per line: punctuation and # or // prefixes are data.
    const result = this.importFromJSON({ keywords: parseText(text) });
    if (!result.success) throw new Error(result.error);
    return result.addedKeywords;
  }
  exportAsText() { return this.getCustomListArray().join('\n'); }
  exportKeywordsAsText() { return this.getCustomKeywordsArray().join('\n'); }
  exportAsJSON() { return JSON.stringify({ ...this.snapshot(), exportedAt: new Date().toISOString() }, null, 2); }
  importFromJSON(input, { replace = false } = {}) {
    try {
      if (typeof input === 'string' && input.length > BLACKLIST_LIMITS.importLength) throw new Error('匯入檔案超過上限');
      const data = typeof input === 'string' ? JSON.parse(input) : input;
      if (!record(data) || (data.version !== undefined && data.version !== '2.0')) throw new Error('不支援的備份格式或版本');
      if (!['blacklist', 'keywords', 'settings', 'allowedUsers'].some(key => Object.hasOwn(data, key))) throw new Error('備份沒有可還原內容');
      const incomingUsers = listFor(Object.hasOwn(data, 'blacklist') ? data.blacklist : [], normalizeBlacklistId, BLACKLIST_LIMITS.users, true);
      const incomingKeywords = listFor(Object.hasOwn(data, 'keywords') ? data.keywords : [], normalizeKeyword, BLACKLIST_LIMITS.keywords, true);
      const incomingAllowed = listFor(Object.hasOwn(data, 'allowedUsers') ? data.allowedUsers : [], normalizeBlacklistId, BLACKLIST_LIMITS.users, true);
      const users = new Set([...(replace ? [] : this.customList), ...incomingUsers]);
      const keywords = new Set([...(replace ? [] : this.customKeywords), ...incomingKeywords]);
      const allowed = new Set([...(replace ? [] : this.allowedUsers), ...incomingAllowed]);
      for (const id of users) allowed.delete(id);
      if (users.size > BLACKLIST_LIMITS.users || keywords.size > BLACKLIST_LIMITS.keywords || allowed.size > BLACKLIST_LIMITS.users) throw new Error('合併後超過清單上限');
      const settings = data.settings === undefined ? { ...(replace ? DEFAULTS : this.settings) } : settingsFor(data.settings, true, replace ? DEFAULTS : this.settings);
      const addedUsers = [...users].filter(id => !this.customList.has(id)).length;
      const addedKeywords = [...keywords].filter(kw => !this.customKeywords.has(kw)).length;
      this.commit({ users, keywords, allowed, settings });
      return { success: true, addedUsers, addedKeywords };
    } catch (error) { return { success: false, error: error.message }; }
  }
  onChange(callback) { if (typeof callback === 'function' && !this.listeners.includes(callback)) this.listeners.push(callback); }
  removeListener(callback) { this.listeners = this.listeners.filter(listener => listener !== callback); }
  notifyChange() { for (const listener of [...this.listeners]) { try { listener(this); } catch (error) { console.error('Blacklist listener error:', error); } } }
}
export const blacklistManager = new BlacklistManager();
