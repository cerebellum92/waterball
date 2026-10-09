// Smart User Tag & Note Manager for Waterball BBS

export const TAG_COLORS = {
  blue: { id: 'blue', label: '藍色', text: '#58a6ff', bg: 'rgba(56, 139, 253, 0.18)', border: '#388bfd' },
  green: { id: 'green', label: '綠色', text: '#3fb950', bg: 'rgba(63, 185, 80, 0.18)', border: '#238636' },
  yellow: { id: 'yellow', label: '黃色', text: '#e3b341', bg: 'rgba(210, 153, 34, 0.18)', border: '#9e6a03' },
  purple: { id: 'purple', label: '紫色', text: '#bc8cff', bg: 'rgba(163, 113, 247, 0.18)', border: '#8957e5' },
  red: { id: 'red', label: '紅色', text: '#ff7b72', bg: 'rgba(248, 81, 73, 0.18)', border: '#da3633' },
  cyan: { id: 'cyan', label: '青色', text: '#56d4dd', bg: 'rgba(57, 197, 187, 0.18)', border: '#1f6feb' },
  gray: { id: 'gray', label: '灰色', text: '#c9d1d9', bg: 'rgba(139, 148, 158, 0.18)', border: '#484f58' },
};

export class UserTagsManager {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.tagsMap = this.loadTags();
    this.listeners = [];
  }

  loadTags() {
    if (!this.storage) return new Map();
    try {
      const raw = this.storage.getItem('bbsterm_user_tags');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          const map = new Map();
          for (const [key, val] of Object.entries(obj)) {
            if (val && typeof val === 'object') {
              const cleanId = String(key).trim().toLowerCase();
              map.set(cleanId, {
                userId: String(val.userId || key).trim(),
                tag: String(val.tag || '').trim(),
                color: TAG_COLORS[val.color] ? val.color : 'blue',
                note: String(val.note || '').trim(),
                updatedAt: Number(val.updatedAt) || Date.now(),
              });
            }
          }
          return map;
        }
      }
    } catch (e) {
      console.warn('Failed to load user tags from storage:', e);
    }
    return new Map();
  }

  saveTags() {
    if (!this.storage) return;
    try {
      const obj = {};
      for (const [key, val] of this.tagsMap.entries()) {
        obj[key] = val;
      }
      this.storage.setItem('bbsterm_user_tags', JSON.stringify(obj));
    } catch (e) {
      console.warn('Failed to save user tags to storage:', e);
    }
    this.notifyChange();
  }

  getTag(userId) {
    if (!userId) return null;
    const cleanId = String(userId).trim().toLowerCase();
    return this.tagsMap.get(cleanId) || null;
  }

  hasTag(userId) {
    if (!userId) return false;
    const cleanId = String(userId).trim().toLowerCase();
    return this.tagsMap.has(cleanId);
  }

  setTag(userId, { tag = '', color = 'blue', note = '' } = {}) {
    if (!userId) return false;
    const cleanId = String(userId).trim().toLowerCase();
    if (cleanId.length < 2) return false;

    const trimmedTag = String(tag || '').trim();
    const trimmedNote = String(note || '').trim();

    // If both tag and note are empty, treat as delete
    if (!trimmedTag && !trimmedNote) {
      return this.removeTag(userId);
    }

    const validColor = TAG_COLORS[color] ? color : 'blue';
    const originalUserId = String(userId).trim();

    this.tagsMap.set(cleanId, {
      userId: originalUserId,
      tag: trimmedTag,
      color: validColor,
      note: trimmedNote,
      updatedAt: Date.now(),
    });

    this.saveTags();
    return true;
  }

  removeTag(userId) {
    if (!userId) return false;
    const cleanId = String(userId).trim().toLowerCase();
    if (this.tagsMap.has(cleanId)) {
      this.tagsMap.delete(cleanId);
      this.saveTags();
      return true;
    }
    return false;
  }

  clear() {
    this.tagsMap.clear();
    this.saveTags();
  }

  getAllTags() {
    return Array.from(this.tagsMap.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  exportJson() {
    const obj = {};
    for (const [key, val] of this.tagsMap.entries()) {
      obj[key] = val;
    }
    return JSON.stringify(obj, null, 2);
  }

  importJson(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('格式錯誤：必須為 JSON 物件');
      }

      let count = 0;
      for (const [key, val] of Object.entries(parsed)) {
        if (val && typeof val === 'object') {
          const cleanId = String(key).trim().toLowerCase();
          if (cleanId.length >= 2) {
            this.tagsMap.set(cleanId, {
              userId: String(val.userId || key).trim(),
              tag: String(val.tag || '').trim(),
              color: TAG_COLORS[val.color] ? val.color : 'blue',
              note: String(val.note || '').trim(),
              updatedAt: Number(val.updatedAt) || Date.now(),
            });
            count++;
          }
        }
      }

      this.saveTags();
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  addListener(fn) {
    if (typeof fn === 'function' && !this.listeners.includes(fn)) {
      this.listeners.push(fn);
    }
  }

  removeListener(fn) {
    const idx = this.listeners.indexOf(fn);
    if (idx !== -1) {
      this.listeners.splice(idx, 1);
    }
  }

  notifyChange() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (e) {
        console.error('Error in userTags listener:', e);
      }
    }
  }
}

// Global default singleton instance
export const userTagsManager = new UserTagsManager();
