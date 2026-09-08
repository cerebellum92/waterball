// Terminal Right-Click Context Menu Controller for Waterball BBS

import { writeClipboardText } from './platform.js';

export class ContextMenuController {
  constructor({
    contextMenuEl,
    blacklistManager,
    onQuickPush,
    onBlacklistChange,
    onShowToast,
  }) {
    this.contextMenuEl = contextMenuEl;
    this.blacklistManager = blacklistManager;
    this.onQuickPush = onQuickPush || (() => {});
    this.onBlacklistChange = onBlacklistChange || (() => {});
    this.onShowToast = onShowToast || (() => {});

    this.activeTarget = '';
    this.activeTab = null;

    this.initEventListeners();
  }

  initEventListeners() {
    if (!this.contextMenuEl) return;

    const ctxCopy = document.getElementById('ctx-copy');
    const ctxCopyAnsi = document.getElementById('ctx-copy-ansi');
    const ctxSearchGoogle = document.getElementById('ctx-search-google');
    const ctxBlacklistToggle = document.getElementById('ctx-blacklist-toggle');
    const ctxQuickPush = document.getElementById('ctx-quick-push');

    ctxCopy?.addEventListener('click', () => {
      if (this.activeTarget) {
        writeClipboardText(this.activeTarget).catch(() => {});
        this.onShowToast('已複製文字至剪貼簿');
      } else if (this.activeTab?.view) {
        const sel = this.activeTab.view.getSelectionText();
        if (sel) {
          writeClipboardText(sel).catch(() => {});
          this.onShowToast('已複製文字至剪貼簿');
        }
      }
      this.hide();
    });

    ctxCopyAnsi?.addEventListener('click', () => {
      if (this.activeTab?.view) {
        const ansi = this.activeTab.view.getSelectionAnsi();
        if (ansi) {
          writeClipboardText(ansi).catch(() => {});
          this.onShowToast('已複製含色彩 ANSI 代碼');
        }
      }
      this.hide();
    });

    ctxSearchGoogle?.addEventListener('click', () => {
      if (this.activeTarget) {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(this.activeTarget)}`, '_blank');
      }
      this.hide();
    });

    ctxBlacklistToggle?.addEventListener('click', () => {
      if (this.activeTarget) {
        const isNowAdded = this.blacklistManager.toggle(this.activeTarget);
        this.onShowToast(isNowAdded ? `已將 ${this.activeTarget} 加入黑名單` : `已將 ${this.activeTarget} 從黑名單移除`);
        this.onBlacklistChange();
      }
      this.hide();
    });

    ctxQuickPush?.addEventListener('click', () => {
      this.hide();
      this.onQuickPush();
    });

    // Dismiss context menu on click outside, resize, or blur
    window.addEventListener('click', (e) => {
      if (this.contextMenuEl && !this.contextMenuEl.contains(e.target)) {
        this.hide();
      }
    });

    window.addEventListener('resize', () => {
      this.hide();
    });

    window.addEventListener('blur', () => {
      this.hide();
    });
  }

  show(info, tab) {
    if (!this.contextMenuEl) return;
    this.activeTab = tab;
    const targetText = info.selectedText || info.word || '';
    this.activeTarget = targetText;

    const ctxBlacklistToggle = document.getElementById('ctx-blacklist-toggle');
    if (ctxBlacklistToggle) {
      if (targetText) {
        const isBl = this.blacklistManager.isBlacklisted(targetText);
        ctxBlacklistToggle.textContent = isBl ? `🚫 從黑名單移除 (${targetText})` : `🚫 加入黑名單 (${targetText})`;
        ctxBlacklistToggle.style.display = 'flex';
      } else {
        ctxBlacklistToggle.style.display = 'none';
      }
    }

    // Positioning with edge collision prevention
    this.contextMenuEl.classList.remove('hidden');
    const menuW = 200;
    const menuH = 180;
    let posX = info.clientX;
    let posY = info.clientY;

    if (posX + menuW > window.innerWidth) {
      posX = window.innerWidth - menuW - 10;
    }
    if (posY + menuH > window.innerHeight) {
      posY = window.innerHeight - menuH - 10;
    }

    this.contextMenuEl.style.left = `${Math.max(10, posX)}px`;
    this.contextMenuEl.style.top = `${Math.max(10, posY)}px`;
  }

  hide() {
    if (this.contextMenuEl && !this.contextMenuEl.classList.contains('hidden')) {
      this.contextMenuEl.classList.add('hidden');
      this.activeTarget = '';
      this.activeTab = null;
    }
  }

  isOpen() {
    return Boolean(this.contextMenuEl && !this.contextMenuEl.classList.contains('hidden'));
  }
}
