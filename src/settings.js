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

import { encryptSecret, decryptSecret } from './crypto.js';

class SettingsManager {
  constructor() {
    this.settings = this.loadSettings();
    this.bookmarks = this.loadBookmarks();
    this.keepAliveTimer = null;
    this.lastActivityTime = Date.now();
    this.onSettingsChange = null;
    this.onBookmarkSelect = null;

    // Auto-migrate legacy plaintext passwords to AES-256-GCM in the background
    this.migratePasswordsToEncrypted();
  }

  async migratePasswordsToEncrypted() {
    let changed = false;
    for (const bm of this.bookmarks) {
      if (bm.password && !bm.password.startsWith('enc:v1:')) {
        bm.password = await encryptSecret(bm.password);
        changed = true;
      }
    }
    if (changed) {
      this.saveBookmarks(this.bookmarks);
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
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load bookmarks from localStorage:', e);
    }
    return [...DEFAULT_BOOKMARKS];
  }

  async saveBookmarks(bookmarks) {
    // Ensure all passwords in bookmarks are encrypted with AES-256-GCM before writing to storage
    const secureBookmarks = [];
    for (const bm of bookmarks) {
      const copy = { ...bm };
      if (copy.password && !copy.password.startsWith('enc:v1:')) {
        copy.password = await encryptSecret(copy.password);
      }
      secureBookmarks.push(copy);
    }

    this.bookmarks = secureBookmarks;
    try {
      localStorage.setItem('bbsterm_bookmarks', JSON.stringify(this.bookmarks));
    } catch (e) {
      console.warn('Failed to save bookmarks to localStorage:', e);
    }
  }

  async addBookmark(bookmark) {
    const copy = { ...bookmark };
    if (copy.password && !copy.password.startsWith('enc:v1:')) {
      copy.password = await encryptSecret(copy.password);
    }
    const newBm = {
      id: 'bm-' + Date.now(),
      ...copy,
    };
    this.bookmarks.push(newBm);
    await this.saveBookmarks(this.bookmarks);
    return newBm;
  }

  async updateBookmark(id, updated) {
    const idx = this.bookmarks.findIndex((b) => b.id === id);
    if (idx !== -1) {
      const copy = { ...updated };
      if (copy.password && !copy.password.startsWith('enc:v1:')) {
        copy.password = await encryptSecret(copy.password);
      }
      this.bookmarks[idx] = { ...this.bookmarks[idx], ...copy };
      await this.saveBookmarks(this.bookmarks);
    }
  }

  deleteBookmark(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.saveBookmarks(this.bookmarks);
  }

  resetDefaultBookmarks() {
    this.bookmarks = [...DEFAULT_BOOKMARKS];
    this.saveBookmarks(this.bookmarks);
    return this.bookmarks;
  }

  /**
   * Securely decrypt bookmark credentials on demand for auto-login
   */
  async getDecryptedCredentials(bookmark) {
    if (!bookmark) return null;
    return {
      username: bookmark.username || '',
      password: bookmark.password ? await decryptSecret(bookmark.password) : '',
    };
  }

  recordActivity() {
    this.lastActivityTime = Date.now();
  }

  startKeepAlive(sendDataFn, isConnectedFn) {
    this.stopKeepAlive();
    this.recordActivity();

    this.keepAliveTimer = setInterval(() => {
      if (!this.settings.antiIdleEnabled) return;
      if (!isConnectedFn || !isConnectedFn()) return;

      const idleSeconds = (Date.now() - this.lastActivityTime) / 1000;
      if (idleSeconds >= this.settings.antiIdleInterval) {
        // Send a harmless NUL / ping control signal to maintain connection without modifying screen
        console.log(`[Keep-Alive] Idle for ${Math.round(idleSeconds)}s, sending heartbeat...`);
        sendDataFn('\x00');
        this.recordActivity();
      }
    }, 15000); // Check idle status every 15s
  }

  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}

export const settingsManager = new SettingsManager();
