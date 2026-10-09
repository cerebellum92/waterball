// UI Controller for Article Monitor & Push Notification Center

import { articleMonitorManager } from './article_monitor.js';
import { writeClipboardText } from './platform.js';

export class ArticleMonitorUI {
  constructor({
    manager = articleMonitorManager,
    onOpenArticleReader = () => {},
    onSwitchBoard = () => {},
    onShowToast = () => {},
  } = {}) {
    this.manager = manager;
    this.onOpenArticleReader = onOpenArticleReader;
    this.onSwitchBoard = onSwitchBoard;
    this.onShowToast = onShowToast;

    // Cache elements
    this.modalEl = document.getElementById('article-monitor-modal');
    this.closeBtn = document.getElementById('monitor-close-btn');
    this.toolbarBtn = document.getElementById('article-monitor-btn');
    this.unreadBadge = document.getElementById('monitor-unread-badge');

    this.tabHistoryBtn = document.getElementById('monitor-tab-history-btn');
    this.tabRulesBtn = document.getElementById('monitor-tab-rules-btn');
    this.paneHistory = document.getElementById('monitor-pane-history');
    this.paneRules = document.getElementById('monitor-pane-rules');

    this.historyList = document.getElementById('monitor-history-list');
    this.rulesList = document.getElementById('monitor-rules-list');
    this.historyCount = document.getElementById('monitor-history-count');
    this.rulesCount = document.getElementById('monitor-rules-count');

    this.checkNowBtn = document.getElementById('monitor-check-now-btn');
    this.markReadBtn = document.getElementById('monitor-mark-read-btn');
    this.clearHistoryBtn = document.getElementById('monitor-clear-history-btn');

    this.addRuleBtn = document.getElementById('monitor-add-rule-btn');
    this.inputBoard = document.getElementById('monitor-input-board');
    this.inputKeywords = document.getElementById('monitor-input-keywords');
    this.inputAuthor = document.getElementById('monitor-input-author');
    this.inputPushes = document.getElementById('monitor-input-pushes');

    this.initEventListeners();
    this.updateToolbarBadge();

    // Listen to manager changes
    this.manager.addListener(() => {
      this.updateToolbarBadge();
      if (this.isOpen()) {
        this.renderHistory();
        this.renderRules();
      }
    });

    // Handle new incoming alert while app is focused
    this.manager.onNewAlert = (alertItem) => {
      this.onShowToast(`📢 [${alertItem.board}] ${alertItem.title}`);
    };
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

    this.modalEl?.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    // Tab switching
    this.tabHistoryBtn?.addEventListener('click', () => {
      this.switchTab('history');
    });

    this.tabRulesBtn?.addEventListener('click', () => {
      this.switchTab('rules');
    });

    // Check now button
    this.checkNowBtn?.addEventListener('click', async () => {
      if (this.checkNowBtn) {
        this.checkNowBtn.textContent = '⏳ 檢查中...';
        this.checkNowBtn.disabled = true;
      }
      try {
        const alerts = await this.manager.checkAll();
        if (alerts.length > 0) {
          this.onShowToast(`檢查完成！發現 ${alerts.length} 篇新文章`);
        } else {
          this.onShowToast('檢查完成，目前無符合條件的新文章');
        }
      } catch (e) {
        this.onShowToast(`檢查失敗: ${e}`);
      } finally {
        if (this.checkNowBtn) {
          this.checkNowBtn.textContent = '⚡ 立即檢查';
          this.checkNowBtn.disabled = false;
        }
      }
    });

    // Mark all read button
    this.markReadBtn?.addEventListener('click', () => {
      this.manager.markAllRead();
      this.renderHistory();
      this.updateToolbarBadge();
      this.onShowToast('已全部標為已讀');
    });

    // Clear history button
    this.clearHistoryBtn?.addEventListener('click', () => {
      if (this.manager.getHistory().length === 0) return;
      if (window.confirm('確定要清空所有追蹤推播紀錄嗎？')) {
        this.manager.clearHistory();
        this.renderHistory();
        this.updateToolbarBadge();
        this.onShowToast('已清空通知紀錄');
      }
    });

    // Add rule button
    this.addRuleBtn?.addEventListener('click', () => {
      const board = this.inputBoard?.value?.trim();
      const keywords = this.inputKeywords?.value?.trim() || '';
      const author = this.inputAuthor?.value?.trim() || '';
      const minPushes = this.inputPushes?.value || 0;

      if (!board) {
        if (this.inputBoard) this.inputBoard.focus();
        this.onShowToast('請輸入要追蹤的看板名稱');
        return;
      }

      this.manager.addRule({ board, keywords, author, minPushes });

      if (this.inputBoard) this.inputBoard.value = '';
      if (this.inputKeywords) this.inputKeywords.value = '';
      if (this.inputAuthor) this.inputAuthor.value = '';
      if (this.inputPushes) this.inputPushes.value = '0';

      this.renderRules();
      this.onShowToast(`已新增 [${board}] 追蹤規則`);
    });

    // Quick board recommendation chips
    const chips = this.modalEl?.querySelectorAll('.chip-btn');
    chips?.forEach((chip) => {
      chip.addEventListener('click', () => {
        const board = chip.getAttribute('data-board');
        if (board && this.inputBoard) {
          this.inputBoard.value = board;
          this.inputKeywords?.focus();
        }
      });
    });
  }

  isOpen() {
    return Boolean(this.modalEl && !this.modalEl.classList.contains('hidden'));
  }

  open(tab = 'history') {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('hidden');
    this.switchTab(tab);
    this.renderHistory();
    this.renderRules();
    this.updateToolbarBadge();
  }

  close() {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
  }

  switchTab(tab) {
    if (tab === 'history') {
      this.tabHistoryBtn?.classList.add('active');
      this.tabRulesBtn?.classList.remove('active');
      this.paneHistory?.classList.remove('hidden');
      this.paneRules?.classList.add('hidden');
      this.manager.markAllRead();
      this.updateToolbarBadge();
    } else {
      this.tabRulesBtn?.classList.add('active');
      this.tabHistoryBtn?.classList.remove('active');
      this.paneRules?.classList.remove('hidden');
      this.paneHistory?.classList.add('hidden');
    }
  }

  updateToolbarBadge() {
    const unread = this.manager.getUnreadCount();
    if (this.unreadBadge) {
      if (unread > 0) {
        this.unreadBadge.textContent = unread > 99 ? '99+' : String(unread);
        this.unreadBadge.classList.remove('hidden');
      } else {
        this.unreadBadge.classList.add('hidden');
      }
    }
    if (this.historyCount) {
      this.historyCount.textContent = String(this.manager.getHistory().length);
    }
    if (this.rulesCount) {
      this.rulesCount.textContent = String(this.manager.getRules().length);
    }
  }

  renderHistory() {
    if (!this.historyList) return;
    this.historyList.innerHTML = '';

    const history = this.manager.getHistory();
    if (history.length === 0) {
      this.historyList.innerHTML = `
        <div class="monitor-empty-box">
          <div style="font-size: 32px; margin-bottom: 8px;">🔔</div>
          <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">目前尚無新文章推播紀錄</div>
          <div style="font-size: 12px; color: var(--text-secondary);">請切換至「追蹤規則與看板」新增您感興趣的看板與關鍵字。</div>
        </div>
      `;
      return;
    }

    history.forEach((item) => {
      const card = document.createElement('div');
      card.className = `monitor-history-card ${item.isRead ? 'read' : 'unread'}`;

      let nrecClass = 'nrec-normal';
      if (item.nrec === '爆') nrecClass = 'nrec-hot';
      else if (parseInt(item.nrec, 10) >= 10) nrecClass = 'nrec-warm';

      const fullUrl = `https://www.ptt.cc${item.link}`;

      card.innerHTML = `
        <div class="card-left">
          <div class="card-badges">
            <span class="board-badge">[${item.board}]</span>
            ${item.nrec ? `<span class="nrec-badge ${nrecClass}">${item.nrec}</span>` : ''}
          </div>
          <div class="card-title">${this.escapeHtml(item.title)}</div>
          <div class="card-meta">
            <span class="card-author">✍️ ${item.author}</span>
            <span class="card-time">🕒 ${item.timeStr || item.date}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-read" title="以圖文好讀模式觀看">📖 好讀版</button>
          <button class="btn-board" title="終端機切換至看板">💻 進板</button>
          <button class="btn-copy" title="複製文章連結">🔗 複製</button>
        </div>
      `;

      // Read button
      card.querySelector('.btn-read')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        this.onOpenArticleReader(fullUrl);
      });

      // Jump to board in terminal
      card.querySelector('.btn-board')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        this.onSwitchBoard(item.board);
      });

      // Copy URL
      card.querySelector('.btn-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        writeClipboardText(fullUrl).catch(() => {});
        this.onShowToast('已複製文章連結');
      });

      // Click card opens reader
      card.addEventListener('click', () => {
        this.close();
        this.onOpenArticleReader(fullUrl);
      });

      this.historyList.appendChild(card);
    });
  }

  renderRules() {
    if (!this.rulesList) return;
    this.rulesList.innerHTML = '';

    const rules = this.manager.getRules();
    if (rules.length === 0) {
      this.rulesList.innerHTML = `
        <div class="monitor-empty-box">
          <div style="font-size: 13px; color: var(--text-secondary);">尚未建立任何追蹤規則，請使用上方表單新增。</div>
        </div>
      `;
      return;
    }

    rules.forEach((rule) => {
      const card = document.createElement('div');
      card.className = `monitor-rule-card ${rule.enabled ? 'enabled' : 'disabled'}`;

      const kwChips =
        rule.keywords && rule.keywords.length > 0
          ? rule.keywords.map((k) => `<span class="rule-kw-chip">${this.escapeHtml(k)}</span>`).join('')
          : '<span class="rule-kw-chip all">全部文章</span>';

      card.innerHTML = `
        <div class="rule-card-left">
          <input type="checkbox" class="rule-toggle-cb" ${rule.enabled ? 'checked' : ''} title="啟用/停用此規則" />
          <div class="rule-details">
            <div class="rule-board-name">[${rule.board}]</div>
            <div class="rule-keywords-row">${kwChips}</div>
            <div class="rule-sub-info">
              ${rule.author ? `<span>作者: <b>${rule.author}</b></span>` : '<span>作者: 不限</span>'}
              <span>門檻: ${rule.minPushes > 0 ? `≥ ${rule.minPushes} 推` : '不限推文'}</span>
            </div>
          </div>
        </div>
        <div class="rule-card-right">
          <button class="rule-btn-delete" title="刪除此規則">🗑️</button>
        </div>
      `;

      card.querySelector('.rule-toggle-cb')?.addEventListener('change', () => {
        this.manager.toggleRule(rule.id);
      });

      card.querySelector('.rule-btn-delete')?.addEventListener('click', () => {
        if (window.confirm(`確定要刪除 [${rule.board}] 的這筆追蹤規則嗎？`)) {
          this.manager.deleteRule(rule.id);
          this.renderRules();
          this.onShowToast('已刪除追蹤規則');
        }
      });

      this.rulesList.appendChild(card);
    });
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

export const articleMonitorUI = new ArticleMonitorUI();
