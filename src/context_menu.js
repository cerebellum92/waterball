// Terminal Right-Click Context Menu Controller for Waterball BBS

import { writeClipboardText, openExternalUrl } from './platform.js';
import { normalizeBlacklistId, BLACKLIST_LIMITS } from './blacklist.js';

export class ContextMenuController {
  constructor({
    contextMenuEl,
    blacklistManager,
    userTagsManager,
    onQuickPush,
    onBlacklistChange,
    onEditTag,
    onSendWaterball,
    onShowToast,
  }) {
    this.contextMenuEl = contextMenuEl;
    this.blacklistManager = blacklistManager;
    this.userTagsManager = userTagsManager;
    this.onQuickPush = onQuickPush || (() => {});
    this.onBlacklistChange = onBlacklistChange || (() => {});
    this.onEditTag = onEditTag || (() => {});
    this.onSendWaterball = onSendWaterball || (() => {});
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
    const ctxWaterballSend = document.getElementById('ctx-waterball-send');
    const ctxTagEdit = document.getElementById('ctx-tag-edit');
    const ctxBlacklistToggle = document.getElementById('ctx-blacklist-toggle');
    const ctxBlacklistKwToggle = document.getElementById('ctx-blacklist-kw-toggle');
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
        openExternalUrl(`https://www.google.com/search?q=${encodeURIComponent(this.activeTarget)}`).catch(console.error);
      }
      this.hide();
    });

    ctxWaterballSend?.addEventListener('click', () => {
      const target = this.activeTarget;
      this.hide();
      this.onSendWaterball(target);
    });

    ctxTagEdit?.addEventListener('click', () => {
      const target = this.activeTarget;
      this.hide();
      this.onEditTag(target);
    });

    ctxBlacklistToggle?.addEventListener('click', () => {
      if (this.activeTarget) {
        try {
          const isNowAdded = this.blacklistManager.toggle(this.activeTarget);
          this.onShowToast(isNowAdded ? `已將 ${this.activeTarget} 加入黑名單` : `已將 ${this.activeTarget} 從黑名單移除`);
          this.onBlacklistChange();
        } catch (error) { this.onShowToast(`黑名單未變更：${error.message}`); }
      }
      this.hide();
    });

    ctxBlacklistKwToggle?.addEventListener('click', () => {
      if (this.activeTarget) {
        try {
          const isNowAdded = this.blacklistManager.toggleKeyword(this.activeTarget);
          const suspended = this.blacklistManager.settings.enabled && this.blacklistManager.settings.enableKeywords && this.blacklistManager.settings.blockWaterball;
          this.onShowToast(isNowAdded ? `已將「${this.activeTarget}」加入關鍵字黑名單${suspended ? '；水球通知與鈴聲暫停，終端仍接收' : ''}` : `已將「${this.activeTarget}」從關鍵字黑名單移除`);
          this.onBlacklistChange();
        } catch (error) { this.onShowToast(`關鍵字未變更：${error.message}`); }
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

    const ctxWaterballSend = document.getElementById('ctx-waterball-send');
    if (ctxWaterballSend) {
      if (targetText) {
        ctxWaterballSend.textContent = `💧 傳送水球給 (${targetText})`;
      } else {
        ctxWaterballSend.textContent = '💧 開啟水球通話紀錄 (Alt+W)';
      }
      ctxWaterballSend.style.display = 'none';
    }

    const ctxTagEdit = document.getElementById('ctx-tag-edit');
    if (ctxTagEdit) {
      if (targetText) {
        const existing = this.userTagsManager?.getTag(targetText);
        ctxTagEdit.textContent = existing
          ? `🏷️ 編輯標籤與備註 (${targetText})`
          : `🏷️ 新增標籤與備註 (${targetText})`;
      } else {
        ctxTagEdit.textContent = '🏷️ 編輯鄉民標籤 / 備註';
      }
      ctxTagEdit.style.display = 'flex';
    }

    const ctxBlacklistToggle = document.getElementById('ctx-blacklist-toggle');
    if (ctxBlacklistToggle) {
      if (normalizeBlacklistId(targetText)) {
        const isBl = this.blacklistManager.hasUserRule(targetText);
        ctxBlacklistToggle.textContent = isBl ? `🚫 從黑名單移除 (${targetText})` : `🚫 加入黑名單 (${targetText})`;
        ctxBlacklistToggle.style.display = 'flex';
      } else {
        ctxBlacklistToggle.style.display = 'none';
      }
    }

    const ctxBlacklistKwToggle = document.getElementById('ctx-blacklist-kw-toggle');
    if (ctxBlacklistKwToggle) {
      if (targetText && targetText.trim().length >= 1 && targetText.length <= BLACKLIST_LIMITS.keywordLength && !/[\x00-\x1f\x7f]/.test(targetText)) {
        const isKw = this.blacklistManager.hasKeywordRule(targetText);
        const snippet = targetText.length > 12 ? `${targetText.slice(0, 10)}…` : targetText;
        ctxBlacklistKwToggle.textContent = isKw
          ? `🔤 移出關鍵字黑名單 ("${snippet}")`
          : `🔤 加入關鍵字黑名單 ("${snippet}")`;
        ctxBlacklistKwToggle.style.display = 'flex';
      } else {
        ctxBlacklistKwToggle.style.display = 'none';
      }
    }

    // Positioning with edge collision prevention
    this.contextMenuEl.classList.remove('hidden');
    const menuW = 220;
    const menuH = 260;
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
