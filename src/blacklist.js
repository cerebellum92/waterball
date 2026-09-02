// Smart Blacklist Manager & Curated PTT "Great Treasure" (大秘寶) Registry for Waterball

export const BUILTIN_GREAT_TREASURE = [
  // Community curated notable PTT shill, spammer & PR farm accounts
  'idcc', 'slow', 'cctv5', 'waynewayne', 'kinki999', 'googles', 'dispptt',
  'kero2377', 'b108077', 'vovhsu', 'leoth', 'danny910', 'sony5566',
  'laputaca', 'orz44444', 'pttisshit', 'zxcv9109', 'hate5566', 'obov5566',
  'crazypal', 'gn01765288', 'bruce0204', 'zzzz8888', 'asdasd123', 'qweqwe123',
  'love5566', 'hero5566', 'jacky5566', 'tony5566', 'andy5566', 'david5566',
  'pushman', 'booman', 'spammer01', 'spammer02', 'praccount01', 'praccount02'
];

class BlacklistManager {
  constructor() {
    this.customList = this.loadCustomList();
    this.settings = this.loadSettings();
    this.greatTreasureSet = new Set(BUILTIN_GREAT_TREASURE.map((id) => id.toLowerCase()));
    this.listeners = [];
  }

  loadSettings() {
    try {
      const stored = localStorage.getItem('bbsterm_blacklist_settings');
      if (stored) {
        return {
          enabled: true,
          mode: 'dim', // 'dim' (25% opacity) | 'hide'
          enableGreatTreasure: true,
          ...JSON.parse(stored),
        };
      }
    } catch (e) {
      console.warn('Failed to load blacklist settings:', e);
    }
    return {
      enabled: true,
      mode: 'dim',
      enableGreatTreasure: true,
    };
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem('bbsterm_blacklist_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Failed to save blacklist settings:', e);
    }
    this.notifyChange();
  }

  loadCustomList() {
    try {
      const stored = localStorage.getItem('bbsterm_blacklist');
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          return new Set(arr.map((id) => String(id).trim().toLowerCase()).filter(Boolean));
        }
      }
    } catch (e) {
      console.warn('Failed to load blacklist from localStorage:', e);
    }
    return new Set();
  }

  saveCustomList() {
    try {
      const arr = Array.from(this.customList);
      localStorage.setItem('bbsterm_blacklist', JSON.stringify(arr));
    } catch (e) {
      console.warn('Failed to save blacklist to localStorage:', e);
    }
    this.notifyChange();
  }

  isBlacklisted(userId) {
    if (!this.settings.enabled || !userId) return false;
    const cleanId = String(userId).trim().toLowerCase();
    if (this.customList.has(cleanId)) return true;
    if (this.settings.enableGreatTreasure && this.greatTreasureSet.has(cleanId)) {
      return true;
    }
    return false;
  }

  add(userId) {
    if (!userId) return false;
    const cleanId = String(userId).trim().toLowerCase();
    if (cleanId.length < 2) return false;
    if (!this.customList.has(cleanId)) {
      this.customList.add(cleanId);
      this.saveCustomList();
      return true;
    }
    return false;
  }

  remove(userId) {
    if (!userId) return false;
    const cleanId = String(userId).trim().toLowerCase();
    if (this.customList.has(cleanId)) {
      this.customList.delete(cleanId);
      this.saveCustomList();
      return true;
    }
    return false;
  }

  toggle(userId) {
    if (this.isBlacklisted(userId)) {
      this.remove(userId);
      return false; // now not blacklisted in custom
    } else {
      this.add(userId);
      return true; // now added
    }
  }

  getCustomListArray() {
    return Array.from(this.customList).sort();
  }

  getGreatTreasureCount() {
    return this.greatTreasureSet.size;
  }

  importFromText(text) {
    if (!text || typeof text !== 'string') return 0;
    let count = 0;
    const lines = text.split(/[\r\n,;\s]+/);
    for (const raw of lines) {
      const clean = raw.trim().toLowerCase();
      if (clean && clean.length >= 2 && !clean.startsWith('#') && !clean.startsWith('//')) {
        if (!this.customList.has(clean)) {
          this.customList.add(clean);
          count++;
        }
      }
    }
    if (count > 0) {
      this.saveCustomList();
    }
    return count;
  }

  exportAsText() {
    return Array.from(this.customList).sort().join('\n');
  }

  exportAsJSON() {
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      blacklist: Array.from(this.customList).sort(),
    }, null, 2);
  }

  onChange(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  notifyChange() {
    for (const cb of this.listeners) {
      try {
        cb(this);
      } catch (e) {
        console.error('Blacklist listener error:', e);
      }
    }
  }
}

export const blacklistManager = new BlacklistManager();
