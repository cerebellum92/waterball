// Waterball (水球) Chat Drawer & History UI Controller for Waterball BBS

import { waterballManager } from './waterball_manager.js';
import { userTagsManager, TAG_COLORS } from './user_tags.js';

export class WaterballUI {
  constructor({
    manager = waterballManager,
    onSendWaterball = () => {},
    onSendMail = () => {},
    onFocusTerminal = () => {},
    onShowToast = () => {},
  } = {}) {
    this.manager = manager;
    this.onSendWaterball = onSendWaterball;
    this.onSendMail = onSendMail;
    this.onFocusTerminal = onFocusTerminal;
    this.onShowToast = onShowToast;

    this.activeContactId = '';
    this.searchQuery = '';

    // Cache elements
    this.modalEl = document.getElementById('waterball-modal');
    this.closeBtn = document.getElementById('wb-close-btn');
    this.contactsListEl = document.getElementById('wb-contacts-list');
    this.searchInput = document.getElementById('wb-search-input');
    this.messagesContainerEl = document.getElementById('wb-messages-container');
    this.replyInput = document.getElementById('wb-reply-input');
    this.replyBtn = document.getElementById('wb-reply-btn');
    this.activeNameEl = document.getElementById('wb-active-name');
    this.activeTagEl = document.getElementById('wb-active-tag');
    this.btnClearChat = document.getElementById('wb-btn-clear-chat');
    this.btnExportChat = document.getElementById('wb-btn-export-chat');
    this.emptyChatPrompt = document.getElementById('wb-empty-chat-prompt');
    this.chatSection = document.getElementById('wb-chat-section');
    this.unreadBadge = document.getElementById('waterball-unread-badge');
    this.toolbarBtn = document.getElementById('waterball-btn');

    // Offline failure banner & Mail compose modal elements
    this.offlineBanner = document.getElementById('wb-offline-banner');
    this.offlineText = document.getElementById('wb-offline-text');
    this.btnSendMail = document.getElementById('wb-btn-send-mail');
    this.mailModalEl = document.getElementById('wb-mail-modal');
    this.mailReceiverInput = document.getElementById('wb-mail-receiver');
    this.mailTitleInput = document.getElementById('wb-mail-title');
    this.mailContentInput = document.getElementById('wb-mail-content');
    this.mailCloseBtn = document.getElementById('wb-mail-close-btn');
    this.mailCancelBtn = document.getElementById('wb-mail-cancel-btn');
    this.mailSubmitBtn = document.getElementById('wb-mail-submit-btn');

    this.initEventListeners();
    this.updateToolbarBadge();

    // Re-render when logs change
    this.manager.addListener(() => {
      this.updateToolbarBadge();
      if (this.isOpen()) {
        this.renderContacts();
        if (this.activeContactId) {
          this.renderMessages(this.activeContactId);
        }
      }
    });

    // Also re-render if user tags change
    userTagsManager.addListener(() => {
      if (this.isOpen()) {
        this.renderContacts();
        this.updateActiveHeader();
      }
    });
  }

  initEventListeners() {
    this.toolbarBtn?.addEventListener('click', () => {
      if (this.isOpen()) {
        this.close();
      } else {
        this.open();
      }
    });

    this.closeBtn?.addEventListener('click', () => this.close());

    this.searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderContacts();
    });

    this.replyBtn?.addEventListener('click', () => this.sendReply());

    this.replyInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendReply();
      }
    });

    this.btnSendMail?.addEventListener('click', () => this.openMailModal());
    this.mailCloseBtn?.addEventListener('click', () => this.closeMailModal());
    this.mailCancelBtn?.addEventListener('click', () => this.closeMailModal());
    this.mailSubmitBtn?.addEventListener('click', () => this.submitMail());

    this.btnClearChat?.addEventListener('click', () => {
      if (!this.activeContactId) return;
      const targetId = this.activeContactId;
      this.manager.deleteConversation(targetId);
      this.activeContactId = '';
      this.renderContacts();
      this.updateActiveHeader();
      this.onShowToast(`已清空與 ${targetId} 的對話紀錄`);
    });

    this.btnExportChat?.addEventListener('click', () => {
      const json = this.manager.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waterball_messages_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.onShowToast('已匯出水球通話紀錄');
    });
  }

  updateToolbarBadge() {
    const unread = this.manager.getTotalUnreadCount();
    if (this.unreadBadge) {
      if (unread > 0) {
        this.unreadBadge.textContent = unread > 99 ? '99+' : String(unread);
        this.unreadBadge.classList.remove('hidden');
      } else {
        this.unreadBadge.classList.add('hidden');
      }
    }
  }

  isOpen() {
    return Boolean(this.modalEl && !this.modalEl.classList.contains('hidden'));
  }

  open(targetContactId = '') {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('hidden');

    this.renderContacts();

    if (targetContactId) {
      this.selectContact(targetContactId);
    } else {
      const contacts = this.manager.getContacts();
      if (contacts.length > 0 && !this.activeContactId) {
        this.selectContact(contacts[0].contactId);
      } else if (this.activeContactId) {
        this.selectContact(this.activeContactId);
      } else {
        this.updateActiveHeader();
      }
    }

    setTimeout(() => {
      if (this.activeContactId && this.replyInput) {
        this.replyInput.focus();
      }
    }, 60);
  }

  close() {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
    this.onFocusTerminal?.();
  }

  renderContacts() {
    if (!this.contactsListEl) return;
    this.contactsListEl.innerHTML = '';

    const allContacts = this.manager.getContacts();
    let contacts = allContacts;

    if (this.searchQuery) {
      const q = this.searchQuery;
      contacts = allContacts.filter((c) =>
        c.contactId.includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
      );
    }

    if (contacts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wb-contacts-empty';
      empty.textContent = this.searchQuery ? '找不到符合的鄉民' : '尚無水球對話紀錄';
      this.contactsListEl.appendChild(empty);
      return;
    }

    contacts.forEach((c) => {
      const item = document.createElement('div');
      item.className = `wb-contact-item ${c.contactId === this.activeContactId ? 'active' : ''}`;

      const userTag = userTagsManager.getTag(c.contactId);
      const tagHtml = userTag && userTag.tag ? (() => {
        const col = TAG_COLORS[userTag.color] || TAG_COLORS.blue;
        return `<span class="wb-user-tag-badge" style="color: ${col.text}; background: ${col.bg}; border-color: ${col.border};">🏷️ ${userTag.tag}</span>`;
      })() : '';

      item.innerHTML = `
        <div class="wb-contact-avatar">👤</div>
        <div class="wb-contact-info">
          <div class="wb-contact-top">
            <span class="wb-contact-name">${c.contactName}</span>
            ${tagHtml}
            <span class="wb-contact-time">${c.lastTime}</span>
          </div>
          <div class="wb-contact-bottom">
            <span class="wb-contact-msg">${this.escapeHtml(c.lastMessage)}</span>
            ${c.unreadCount > 0 ? `<span class="wb-unread-pill">${c.unreadCount}</span>` : ''}
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        this.selectContact(c.contactId);
      });

      this.contactsListEl.appendChild(item);
    });
  }

  selectContact(contactId) {
    if (!contactId) return;
    this.activeContactId = contactId.toLowerCase();
    this.manager.markRead(this.activeContactId);
    this.updateToolbarBadge();
    this.hideOfflineBanner();

    // Highlight selected in list
    if (this.contactsListEl) {
      this.contactsListEl.querySelectorAll('.wb-contact-item').forEach((el) => {
        el.classList.remove('active');
      });
    }

    this.updateActiveHeader();
    this.renderMessages(this.activeContactId);

    // Re-render contacts to clear unread badge
    this.renderContacts();

    if (this.replyInput) {
      this.replyInput.focus();
    }
  }

  showOfflineBanner(msg) {
    if (this.offlineBanner) {
      if (this.offlineText && msg) this.offlineText.textContent = msg;
      this.offlineBanner.classList.remove('hidden');
    }
  }

  hideOfflineBanner() {
    if (this.offlineBanner) {
      this.offlineBanner.classList.add('hidden');
    }
  }

  openMailModal() {
    if (!this.activeContactId || !this.mailModalEl) return;
    const msgs = this.manager.getMessages(this.activeContactId);
    const targetName = msgs[0]?.contactName || this.activeContactId;
    const text = this.replyInput ? this.replyInput.value.trim() : '';
    const defaultTitle = `[水球留言] ${text.slice(0, 18).trim()}${text.length > 18 ? '...' : ''}`;

    if (this.mailReceiverInput) this.mailReceiverInput.value = targetName;
    if (this.mailTitleInput) this.mailTitleInput.value = defaultTitle;
    if (this.mailContentInput) this.mailContentInput.value = text;

    this.mailModalEl.classList.remove('hidden');
    setTimeout(() => this.mailTitleInput?.focus(), 60);
  }

  closeMailModal() {
    if (this.mailModalEl) {
      this.mailModalEl.classList.add('hidden');
    }
  }

  async submitMail() {
    if (!this.mailReceiverInput || !this.mailTitleInput || !this.mailContentInput) return;
    const receiver = this.mailReceiverInput.value.trim();
    const title = this.mailTitleInput.value.trim();
    const content = this.mailContentInput.value.trim();
    if (!receiver || !content) {
      this.onShowToast('請輸入收件人與信件內容');
      return;
    }

    if (this.mailSubmitBtn) {
      this.mailSubmitBtn.disabled = true;
      this.mailSubmitBtn.textContent = '寄送中...';
    }

    try {
      const res = await this.onSendMail(receiver, title || '水球留言', content);
      if (res && res.success) {
        this.closeMailModal();
        this.hideOfflineBanner();
        if (this.replyInput) this.replyInput.value = '';
        this.manager.addOutgoingMessage({
          receiver,
          message: `[✉️ 站內信: ${title || '水球留言'}] ${content}`,
        });
        this.renderMessages(this.activeContactId);
        this.renderContacts();
        this.onShowToast(`✉️ 已成功寄送站內信給 ${receiver}`);
      } else {
        this.onShowToast(`❌ 寄信失敗：${res?.text || '無法送出信件'}`);
      }
    } catch (err) {
      console.error('Mail submit error:', err);
      this.onShowToast('❌ 寄信發生錯誤');
    } finally {
      if (this.mailSubmitBtn) {
        this.mailSubmitBtn.disabled = false;
        this.mailSubmitBtn.textContent = '🚀 確認寄出信件';
      }
    }
  }

  updateActiveHeader() {
    if (!this.activeContactId) {
      if (this.chatSection) this.chatSection.classList.add('hidden');
      if (this.emptyChatPrompt) this.emptyChatPrompt.classList.remove('hidden');
      return;
    }

    if (this.chatSection) this.chatSection.classList.remove('hidden');
    if (this.emptyChatPrompt) this.emptyChatPrompt.classList.add('hidden');

    const msgs = this.manager.getMessages(this.activeContactId);
    const displayName = msgs[0]?.contactName || this.activeContactId;

    if (this.activeNameEl) {
      this.activeNameEl.textContent = displayName;
    }

    if (this.activeTagEl) {
      const userTag = userTagsManager.getTag(this.activeContactId);
      if (userTag && userTag.tag) {
        const col = TAG_COLORS[userTag.color] || TAG_COLORS.blue;
        this.activeTagEl.textContent = `🏷️ ${userTag.tag}`;
        this.activeTagEl.style.color = col.text;
        this.activeTagEl.style.background = col.bg;
        this.activeTagEl.style.borderColor = col.border;
        this.activeTagEl.title = userTag.note || '';
        this.activeTagEl.classList.remove('hidden');
      } else {
        this.activeTagEl.classList.add('hidden');
      }
    }
  }

  renderMessages(contactId) {
    if (!this.messagesContainerEl) return;
    this.messagesContainerEl.innerHTML = '';

    const msgs = this.manager.getMessages(contactId);
    if (msgs.length === 0) {
      this.messagesContainerEl.innerHTML = '<div class="wb-msgs-empty">尚無對話內容</div>';
      return;
    }

    msgs.forEach((m) => {
      const row = document.createElement('div');
      row.className = `wb-msg-row ${m.isMine ? 'mine' : 'theirs'}`;

      row.innerHTML = `
        <div class="wb-msg-bubble">
          <div class="wb-msg-text">${this.escapeHtml(m.message)}</div>
          <div class="wb-msg-time">${m.time}</div>
        </div>
      `;

      this.messagesContainerEl.appendChild(row);
    });

    // Auto scroll to bottom
    this.messagesContainerEl.scrollTop = this.messagesContainerEl.scrollHeight;
  }

  async sendReply() {
    if (!this.activeContactId || !this.replyInput) return;
    const text = this.replyInput.value.trim();
    if (!text) return;

    const msgs = this.manager.getMessages(this.activeContactId);
    const targetName = msgs[0]?.contactName || this.activeContactId;

    this.hideOfflineBanner();
    if (this.replyBtn) {
      this.replyBtn.disabled = true;
      this.replyBtn.textContent = '發送中...';
    }

    try {
      const res = await this.onSendWaterball(targetName, text);
      if (res && res.success) {
        this.manager.addOutgoingMessage({
          receiver: targetName,
          message: text,
        });
        this.replyInput.value = '';
        this.renderMessages(this.activeContactId);
        this.renderContacts();
        this.onShowToast(`已發送水球給 ${targetName}`);
      } else {
        // Keep text in replyInput to prevent losing user's draft
        this.showOfflineBanner(res?.text || `${targetName} 目前不在線上，水球無法送達。`);
        this.onShowToast(`❌ 發送失敗：${res?.text || '對方已離線'}`);
      }
    } catch (err) {
      console.error('Send waterball error:', err);
      this.onShowToast('❌ 發送水球發生錯誤');
    } finally {
      if (this.replyBtn) {
        this.replyBtn.disabled = false;
        this.replyBtn.textContent = '🚀 發送水球';
      }
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const waterballUI = new WaterballUI();
