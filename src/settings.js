// Settings Center, Bookmarks Manager & Keep-Alive Controller

export const DEFAULT_BOOKMARKS = [
  {
    id: 'ptt-ssh',
    name: '批踢踢實業坊 (PTT SSH)',
    address: 'bbs@ptt.cc:22',
    encoding: 'big5',
    description: '台灣最大 BBS 站台 (SSH Port 22)',
  },
  {
    id: 'ptt-telnet',
    name: '批踢踢實業坊 (PTT Telnet)',
    address: 'ptt.cc:23',
    encoding: 'big5',
    description: '批踢踢 Telnet 連線 (Port 23 / 8888)',
  },
  {
    id: 'ptt2-ssh',
    name: '批踢踢兔 (PTT2 SSH)',
    address: 'bbs@ptt2.cc:22',
    encoding: 'big5',
    description: '批踢踢個人板站台 (SSH Port 22)',
  },
  {
    id: 'ncku-pt',
    name: '成大物治˙黃金之島',
    address: 'nckugibbs.duckdns.org',
    encoding: 'big5',
    description: '成大物理治療系 BBS 站',
  },
  {
    id: 'bahamut',
    name: '巴哈姆特電玩資訊站',
    address: 'bbs.gamer.com.tw:23',
    encoding: 'big5',
    description: '台灣歷史悠久電玩 BBS 站台',
  },
];

export const DEFAULT_SETTINGS = {
  // Keep-alive
  antiIdleEnabled: true,
  antiIdleInterval: 60, // seconds
  autoReconnect: false,

  // Notifications
  notifyEnabled: true,
  notifySound: true,

  // Keyboard & Mouse
  mapCommandToCtrl: true,
  smartDbcsBackspace: true,
  wheelScrollPage: true,
  autoCopySelection: false,

  // Display & Theme
  theme: 'pcman', // 'pcman' | 'welly' | 'high-contrast'
  cursorStyle: 'smart', // 'smart' | 'underline' | 'bar' | 'block' | 'hollow' | 'none'
  cursorBlinkRate: 500, // ms
  imagePreviewEnabled: true,
  toolbarScale: 'medium', // 'standard' | 'medium' | 'large'
  fontFamily: 'auto', // 'auto' | 'mingliu' | 'jhenghei' | 'monospace'
  customFont: '', // Custom font name
};

import {
  decryptSecret,
  secureSaveCredential,
  secureGetCredential,
  secureDeleteCredential,
  secureStoreBackend,
  removeLegacyCryptoSeed,
} from './crypto.js';

class SettingsManager {
  constructor() {
    this.settings = this.loadSettings();
    this.bookmarks = this.loadBookmarks();
    this.keepAliveTimer = null;
    this.lastActivityTime = Date.now();
    this.onSettingsChange = null;
    this.onBookmarkSelect = null;

    // Auto-migrate legacy passwords (plaintext or local AES in localStorage) to OS Keyring / Native Vault
    this.migratePasswordsToNativeVault();
  }

  async migratePasswordsToNativeVault() {
    let changed = false;
    let hadLegacyPasswords = false;
    for (const bm of this.bookmarks) {
      if (bm.password && bm.password !== '__SECURE_VAULT__') {
        hadLegacyPasswords = true;
        let plainPass = bm.password;
        if (plainPass.startsWith('enc:v1:')) {
          plainPass = await decryptSecret(plainPass);
        }
        if (plainPass) {
          await secureSaveCredential(bm.id, plainPass);
          bm.hasPassword = true;
        } else {
          bm.hasPassword = false;
        }
        bm.password = bm.hasPassword ? '__SECURE_VAULT__' : '';
        changed = true;
      } else if (bm.password === '__SECURE_VAULT__') {
        bm.hasPassword = true;
      }
    }
    if (changed) {
      this.saveBookmarks(this.bookmarks);
    }
    if (hadLegacyPasswords) {
      removeLegacyCryptoSeed();
    }
  }

  loadSettings() {
    try {
      const stored = localStorage.getItem('bbsterm_settings');
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Failed to load settings from localStorage:', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem('bbsterm_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
    this.onSettingsChange?.(this.settings);
  }

  loadBookmarks() {
    try {
      const stored = localStorage.getItem('bbsterm_bookmarks');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((bm) => ({
            ...bm,
            hasPassword: Boolean(bm.hasPassword || (bm.password && bm.password !== '')),
          }));
        }
      }
    } catch (e) {
      console.warn('Failed to load bookmarks from localStorage:', e);
    }
    return [...DEFAULT_BOOKMARKS];
  }

  saveBookmarks(bookmarks) {
    // Only metadata and sanitized placeholder are kept in localStorage
    // Passwords NEVER stay in localStorage!
    const sanitized = bookmarks.map((bm) => {
      const copy = { ...bm };
      if (copy.password && copy.password !== '__SECURE_VAULT__') {
        copy.hasPassword = true;
      }
      copy.password = copy.hasPassword ? '__SECURE_VAULT__' : '';
      return copy;
    });

    this.bookmarks = sanitized;
    try {
      localStorage.setItem('bbsterm_bookmarks', JSON.stringify(this.bookmarks));
    } catch (e) {
      console.warn('Failed to save bookmarks to localStorage:', e);
    }
  }

  async addBookmark(bookmark) {
    const id = 'bm-' + Date.now();
    const { password, ...rest } = bookmark;
    const hasPassword = Boolean(password && password.trim());
    if (hasPassword) {
      await secureSaveCredential(id, password.trim());
    }
    const newBm = {
      id,
      ...rest,
      hasPassword,
      password: hasPassword ? '__SECURE_VAULT__' : '',
    };
    this.bookmarks.push(newBm);
    this.saveBookmarks(this.bookmarks);
    return newBm;
  }

  async updateBookmark(id, updated) {
    const idx = this.bookmarks.findIndex((b) => b.id === id);
    if (idx !== -1) {
      const current = this.bookmarks[idx];
      let hasPassword = Boolean(current.hasPassword);

      if ('password' in updated) {
        const pass = updated.password ? updated.password.trim() : '';
        if (pass && pass !== '__SECURE_VAULT__') {
          await secureSaveCredential(id, pass);
          hasPassword = true;
        } else if (pass === '') {
          await secureDeleteCredential(id);
          hasPassword = false;
        }
      }

      const { password, ...rest } = updated;
      this.bookmarks[idx] = {
        ...current,
        ...rest,
        hasPassword,
        password: hasPassword ? '__SECURE_VAULT__' : '',
      };
      this.saveBookmarks(this.bookmarks);
    }
  }

  async deleteBookmark(id) {
    await secureDeleteCredential(id);
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.saveBookmarks(this.bookmarks);
  }

  resetDefaultBookmarks() {
    this.bookmarks = [...DEFAULT_BOOKMARKS];
    this.saveBookmarks(this.bookmarks);
    return this.bookmarks;
  }

  /**
   * Securely retrieve credentials on demand from OS Keyring / Native Vault for auto-login
   */
  async getDecryptedCredentials(bookmark) {
    if (!bookmark) return null;
    let password = '';
    if (bookmark.password === '__SECURE_VAULT__' || bookmark.hasPassword) {
      password = await secureGetCredential(bookmark.id);
    } else if (bookmark.password) {
      // Legacy unmigrated
      if (bookmark.password.startsWith('enc:v1:')) {
        password = await decryptSecret(bookmark.password);
      } else {
        password = bookmark.password;
      }
      if (password) {
        await secureSaveCredential(bookmark.id, password);
        bookmark.password = '__SECURE_VAULT__';
        bookmark.hasPassword = true;
        this.saveBookmarks(this.bookmarks);
      }
    }
    return {
      username: bookmark.username || '',
      password: password || '',
    };
  }

  async getSecureStorageStatus() {
    return await secureStoreBackend();
  }

  recordActivity() {
    this.lastActivityTime = Date.now();
  }
}

export const settingsManager = new SettingsManager();
