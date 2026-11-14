// Live Chat Mode (實況推文聊天室模式) for Waterball BBS
// Transforms PTT live match/broadcast articles into a modern, real-time streaming chat feed.

import { ArticleParser } from './article_reader.js';
import { blacklistManager } from './blacklist.js';
import { userTagsManager, TAG_COLORS } from './user_tags.js';
import { isTauri, setAlwaysOnTop } from './platform.js';
import { filenameToAid, detectCurrentBoard, boardFromHeaderLine, parseAidInput } from './aid_helper.js';
import { imagePreview, isImageUrl, parseYoutubeUrl } from './image_preview.js';

export class LiveChatModal {
  constructor(options = {}) {
    this.tabManager = options.tabManager;
    this.settingsManager = options.settingsManager;
    this.imagePreview = options.imagePreview || imagePreview;
    this.getConnectionSession = options.getConnectionSession;
    this.sendToTab = options.sendToTab;
    this.pushHelper = options.pushHelper;
    this.onShowToast = options.onShowToast || (() => {});
    this.onEditUserTag = options.onEditUserTag || (() => {});
    this.onShowUserTooltip = options.onShowUserTooltip || (() => {});
    this.onHideUserTooltip = options.onHideUserTooltip || (() => {});
    this.onOpenReader = options.onOpenReader || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.getUserId = options.getUserId || (() => '');

    this.isOpen = false;
    this.tab = null;
    this.currentArticle = null;
    this.targetAid = null;
    this.targetBoard = null;
    this.targetTitle = '';
    this.targetAuthor = '';
    this.pollTimer = null;
    this.pollIntervalMs = 2500;
    try {
      if (typeof localStorage !== 'undefined') {
        const savedPoll = Number.parseInt(localStorage.getItem('bbsterm_live_chat_poll_ms'), 10);
        if ([0, 1500, 2500, 4000].includes(savedPoll)) {
          this.pollIntervalMs = savedPoll;
        }
      }
    } catch {}
    this.autoScroll = true;
    this.unreadCount = 0;
    this.isSending = false;
    this.isPolling = false;
    this.activeType = '1'; // '1': 推, '2': 噓, '3': →
    this.filterType = 'all'; // 'all', 'push', 'boo', 'arrow'
    this.filterUser = null;
    this.pushes = [];
    this.seenSignatures = new Set();
    this.revealedBlacklistFloors = new Set();
    this.filteredCount = 0;
    this.isPinned = false;
    this.isCrawlingHistory = false;
    this.oldestCapturedLineNum = null;
    this.oldestCapturedPageNum = null;
    this.hasMoreHistory = false;
    this.canUseGotoPrompt = true;
    this.gotoFailCount = 0;
    this._suppressScrollCheck = false;
    this._suppressLoadEarlier = false;
    this._didInitialScrollToBottom = false;
    this._programmaticScrollToBottom = false;
    this._smoothScrollTimer = null;
    this._lastBottomScrollTop = 0;

    this.ytPreviewDelayMs = options.ytPreviewDelayMs ?? 180;
    this.ytHideDelayMs = options.ytHideDelayMs ?? 220;
    this.ytPreviewEl = null;
    this.ytMiniPlayerEl = null;
    this.ytShowTimer = null;
    this.ytHideTimer = null;
    this.ytPreviewVisible = false;
    this.currentHoverImgLink = null;
    this.currentHoverYtLink = null;
    this.currentHoverUserTarget = null;
    this.activeHoverYtInfo = null;
    this.activeHoverYtTriggerEl = null;
    this.activeMiniPlayerYtInfo = null;
    this.isMiniPlayerWide = false;
    this.miniPlayerManualPos = null;
    this._boundGlobalKeyDown = null;

    this.fontSize = 15;
    let savedFontSize = 15;
    try {
      if (typeof localStorage !== 'undefined') {
        const parsed = Number.parseInt(localStorage.getItem('bbsterm_live_chat_font_size'), 10);
        if (Number.isFinite(parsed) && parsed >= 12 && parsed <= 26) {
          savedFontSize = parsed;
        }
      }
    } catch {}
    this.fontSize = savedFontSize;

    this.createDom();
    if (this.speedSelect) {
      this.speedSelect.value = String(this.pollIntervalMs);
    }
    this.applyFontSize();

    // Re-render when blacklist rules change
    blacklistManager.onChange(() => {
      if (this.isOpen) {
        this.renderAllPushes();
      }
    });

    // Re-render when user tags change
    if (typeof userTagsManager?.addListener === 'function') {
      userTagsManager.addListener(() => {
        if (this.isOpen) {
          this.renderAllPushes();
        }
      });
    } else if (typeof userTagsManager?.onChange === 'function') {
      userTagsManager.onChange(() => {
        if (this.isOpen) {
          this.renderAllPushes();
        }
      });
    }
  }

  createDom() {
    if (typeof document === 'undefined') return;

    const modal = document.createElement('div');
    modal.id = 'live-chat-modal';
    modal.className = 'live-chat-modal hidden';

    modal.innerHTML = `
      <div class="live-chat-header">
        <div class="live-chat-header-left">
          <button type="button" id="live-chat-close-btn" class="live-chat-btn-close" title="關閉實況聊天室 (ESC)">✕ 關閉</button>
          <span id="live-chat-board-badge" class="live-chat-board-badge">BBS</span>
          <span class="live-pulse-badge" id="live-pulse-badge" title="推文實況自動輪詢中">
            <span class="live-pulse-dot"></span>實況中
          </span>
          <h2 id="live-chat-title" class="live-chat-title" title="文章標題">實況聊天室</h2>
        </div>
        <div class="live-chat-header-right">
          <div id="live-chat-stats-badges" class="live-chat-stats-badges">
            <span class="live-stat-badge push" id="live-stat-push" title="推數">推 0</span>
            <span class="live-stat-badge boo" id="live-stat-boo" title="噓數">噓 0</span>
            <span class="live-stat-badge arrow" id="live-stat-arrow" title="箭頭數">→ 0</span>
            <span class="live-stat-badge total" id="live-stat-total" title="總留言數">共 0 則</span>
          </div>
          <div class="live-chat-controls">
            <div class="font-size-controls" id="live-chat-font-controls" title="調整字體大小">
              <button type="button" id="live-chat-font-dec" title="縮小字體">A-</button>
              <span id="live-chat-font-val">${this.fontSize}px</span>
              <button type="button" id="live-chat-font-inc" title="放大字體">A+</button>
            </div>
            <select id="live-chat-speed-select" class="live-chat-speed-select" title="推文自動更新頻率">
              <option value="1500">⚡ 1.5 秒</option>
              <option value="2500" selected>⚡ 2.5 秒 (預設)</option>
              <option value="4000">⚡ 4.0 秒</option>
              <option value="0">⏸ 暫停更新</option>
            </select>
            <div class="live-chat-filter-group">
              <button type="button" class="live-filter-btn active" data-filter="all">全部</button>
              <button type="button" class="live-filter-btn" data-filter="push">推</button>
              <button type="button" class="live-filter-btn" data-filter="boo">噓</button>
              <button type="button" class="live-filter-btn" data-filter="arrow">→</button>
            </div>
            <button type="button" id="live-chat-pin-btn" class="live-chat-btn-action hidden" title="視窗置頂 (邊看實況邊追推文)">📌 置頂</button>
            <button type="button" id="live-chat-to-reader-btn" class="live-chat-btn-action" title="切換至圖文好讀版">📖 好讀版</button>
          </div>
        </div>
      </div>

      <div id="live-chat-filter-banner" class="live-chat-filter-banner hidden">
        <span id="live-chat-filter-banner-text">正在篩選特定使用者...</span>
        <button type="button" id="live-chat-filter-clear-btn" class="live-chat-filter-clear-btn">清除篩選</button>
      </div>

      <div class="live-chat-body" id="live-chat-scroll-container">
        <div class="live-chat-stream" id="live-chat-stream">
          <div class="live-chat-welcome-card" id="live-chat-welcome">
            <div class="welcome-icon">📺</div>
            <div class="welcome-title">歡迎進入 PTT 實況聊天室模式</div>
            <div class="welcome-desc">系統正自動追蹤最新推文串流，邊看球賽、比賽或實況轉播，邊與鄉民即時互動！</div>
            <div class="welcome-tips">💡 支援黑名單過濾、自訂標籤，於下方輸入即可直接推文。</div>
          </div>
        </div>
        <button type="button" id="live-chat-unread-pill" class="live-chat-unread-pill hidden">
          ↓ 有新推文 (點擊滾動到底部)
        </button>
      </div>

      <div class="live-chat-footer">
        <div class="live-chat-input-row">
          <div class="live-chat-type-toggles" id="live-chat-type-toggles">
            <button type="button" class="live-type-btn push active" data-type="1" title="推 (預設)">推</button>
            <button type="button" class="live-type-btn boo" data-type="2" title="噓">噓</button>
            <button type="button" class="live-type-btn arrow" data-type="3" title="只加註解 (→)">→</button>
          </div>
          <div class="live-chat-input-wrapper">
            <input type="text" id="live-chat-input" class="live-chat-input" placeholder="說點什麼... (Enter 送出，支援長文)" maxlength="500" autocomplete="off" />
            <span id="live-chat-char-counter" class="live-chat-char-counter">0 字</span>
          </div>
          <button type="button" id="live-chat-send-btn" class="live-chat-btn-send" title="送出推文 (Enter)">送出 ⏎</button>
        </div>
        <div class="live-chat-quick-chips">
          <span class="chips-label">快速用語：</span>
          <button type="button" class="quick-chip-btn" data-text="太神啦！">太神啦！</button>
          <button type="button" class="quick-chip-btn" data-text="推推推">推推推</button>
          <button type="button" class="quick-chip-btn" data-text="幫QQ">幫QQ</button>
          <button type="button" class="quick-chip-btn" data-text="笑死">笑死</button>
          <button type="button" class="quick-chip-btn" data-text="穩了">穩了</button>
          <button type="button" class="quick-chip-btn" data-text="這波操作太狂">這波操作太狂</button>
          <button type="button" class="quick-chip-btn" data-text="???">???</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    // Cache elements
    this.streamEl = modal.querySelector('#live-chat-stream');
    this.scrollContainer = modal.querySelector('#live-chat-scroll-container');
    this.titleEl = modal.querySelector('#live-chat-title');
    this.boardBadgeEl = modal.querySelector('#live-chat-board-badge');
    this.pulseBadge = modal.querySelector('#live-pulse-badge');
    this.unreadPill = modal.querySelector('#live-chat-unread-pill');
    this.inputEl = modal.querySelector('#live-chat-input');
    this.charCounter = modal.querySelector('#live-chat-char-counter');
    this.sendBtn = modal.querySelector('#live-chat-send-btn');
    this.pinBtn = modal.querySelector('#live-chat-pin-btn');
    this.speedSelect = modal.querySelector('#live-chat-speed-select');
    this.filterBanner = modal.querySelector('#live-chat-filter-banner');
    this.filterBannerText = modal.querySelector('#live-chat-filter-banner-text');

    this.statPush = modal.querySelector('#live-stat-push');
    this.statBoo = modal.querySelector('#live-stat-boo');
    this.statArrow = modal.querySelector('#live-stat-arrow');
    this.statTotal = modal.querySelector('#live-stat-total');

    this.ensureYoutubeUiDom();
    this.bindEvents();
  }

  bindEvents() {
    if (!this.modalEl) return;

    // Close button
    this.modalEl.querySelector('#live-chat-close-btn')?.addEventListener('click', () => this.close());

    // Font size controls
    this.modalEl.querySelector('#live-chat-font-dec')?.addEventListener('click', () => this.adjustFontSize(-2));
    this.modalEl.querySelector('#live-chat-font-inc')?.addEventListener('click', () => this.adjustFontSize(2));

    // Switch to Reader
    this.modalEl.querySelector('#live-chat-to-reader-btn')?.addEventListener('click', () => {
      const article = this.currentArticle;
      const tab = this.tab;
      this.close();
      this.onOpenReader?.(tab, article);
    });

    // Pin window (Always-on-top for Desktop)
    if (this.pinBtn) {
      if (isTauri()) {
        this.pinBtn.classList.remove('hidden');
      }
      this.pinBtn.addEventListener('click', async () => {
        this.isPinned = !this.isPinned;
        await setAlwaysOnTop(this.isPinned);
        this.pinBtn.classList.toggle('active', this.isPinned);
        this.pinBtn.title = this.isPinned ? '取消視窗置頂' : '視窗置頂 (邊看實況邊追推文)';
        this.onShowToast?.(this.isPinned ? '已開啟視窗置頂 📌' : '已取消視窗置頂');
      });
    }

    // Speed Select
    this.speedSelect?.addEventListener('change', (e) => {
      const ms = parseInt(e.target.value, 10);
      this.pollIntervalMs = ms;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('bbsterm_live_chat_poll_ms', String(ms));
        }
      } catch {}
      this.restartPolling();
    });

    // Filter Buttons (All / Push / Boo / Arrow)
    this.modalEl.querySelectorAll('.live-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.modalEl.querySelectorAll('.live-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.filterType = btn.dataset.filter || 'all';
        this.renderAllPushes();
      });
    });

    // Clear User Filter
    this.modalEl.querySelector('#live-chat-filter-clear-btn')?.addEventListener('click', () => {
      this.filterUser = null;
      this.filterBanner?.classList.add('hidden');
      this.renderAllPushes();
    });

    // Scroll listener for auto-scroll pause / resume & manual earlier-history trigger
    const cancelSmoothScrollGuard = () => {
      this._programmaticScrollToBottom = false;
      if (this._smoothScrollTimer) {
        clearTimeout(this._smoothScrollTimer);
        this._smoothScrollTimer = null;
      }
    };
    this.scrollContainer?.addEventListener('wheel', cancelSmoothScrollGuard, { passive: true });
    this.scrollContainer?.addEventListener('touchstart', cancelSmoothScrollGuard, { passive: true });
    this.scrollContainer?.addEventListener('pointerdown', cancelSmoothScrollGuard, { passive: true });

    this.scrollContainer?.addEventListener('scroll', () => {
      this.hideMediaHoverPreviews();
      if (!this.scrollContainer) return;

      const atBottom = this.isScrollContainerAtBottom();
      if (this._programmaticScrollToBottom) {
        if (atBottom) {
          cancelSmoothScrollGuard();
          this.autoScroll = true;
          this._recordBottomScrollTop();
          this.unreadCount = 0;
          this.updateUnreadPill();
        }
        return;
      }

      if (atBottom) {
        this.autoScroll = true;
        this._recordBottomScrollTop();
        this.unreadCount = 0;
        this.updateUnreadPill();
      } else {
        this.autoScroll = false;
        if (!this._suppressScrollCheck && !this._suppressLoadEarlier) {
          const scrollTop = Number(this.scrollContainer.scrollTop) || 0;
          if (scrollTop < 120 && this.hasMoreHistory && !this.isSending && !this.isPolling && !this.isCrawlingHistory) {
            void this.loadEarlierPushes(this.tab);
          }
        }
      }
    });

    // Unread Pill click
    this.unreadPill?.addEventListener('click', () => {
      this.autoScroll = true;
      this.unreadCount = 0;
      this.updateUnreadPill();
      cancelSmoothScrollGuard();
      this._programmaticScrollToBottom = true;
      this.scrollToBottom(true);
      this._smoothScrollTimer = setTimeout(() => {
        this._smoothScrollTimer = null;
        this._programmaticScrollToBottom = false;
      }, 450);
      this._smoothScrollTimer?.unref?.();
    });

    // Push Type Toggle buttons (推 / 噓 / →)
    this.modalEl.querySelectorAll('.live-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.modalEl.querySelectorAll('.live-type-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeType = btn.dataset.type || '1';
        this.inputEl?.focus();
      });
    });

    // Input typing & counter
    this.inputEl?.addEventListener('input', () => {
      this.updateCharCount();
    });

    // Input Enter to send
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
        e.preventDefault();
        this.handleSendPush();
      }
    });

    // Send button click
    this.sendBtn?.addEventListener('click', () => {
      this.handleSendPush();
    });

    // Quick chips
    this.modalEl.querySelectorAll('.quick-chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.text || '';
        if (this.inputEl) {
          this.inputEl.value = (this.inputEl.value + ' ' + text).trim();
          this.updateCharCount();
          this.inputEl.focus();
        }
      });
    });

    this.bindMediaPreviewEvents();
  }

  updateCharCount() {
    if (!this.inputEl || !this.charCounter) return;
    const text = this.inputEl.value;
    const len = text.length;
    if (len === 0) {
      this.charCounter.textContent = '0 字';
      this.charCounter.classList.remove('near-limit');
      return;
    }
    const segments = this.pushHelper?.splitText ? this.pushHelper.splitText(text) : [text];
    const segCount = Math.max(1, segments.length);
    this.charCounter.textContent = segCount > 1 ? `${len} 字 (${segCount} 段)` : `${len} 字`;
    this.charCounter.classList.toggle('near-limit', len >= 400);
  }

  applyFontSize() {
    const fontVal = this.modalEl?.querySelector('#live-chat-font-val');
    if (fontVal) fontVal.textContent = `${this.fontSize}px`;

    if (this.modalEl) {
      if (this.modalEl.style?.setProperty) {
        this.modalEl.style.setProperty('--live-chat-font-size', `${this.fontSize}px`);
      } else if (this.modalEl.style) {
        this.modalEl.style['--live-chat-font-size'] = `${this.fontSize}px`;
      }
    }
  }

  adjustFontSize(delta) {
    this.fontSize = Math.max(12, Math.min(26, this.fontSize + delta));
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('bbsterm_live_chat_font_size', String(this.fontSize));
      }
    } catch {}
    this.applyFontSize();
  }

  async open(tab, initialArticle = null) {
    if (!tab || !tab.buf) return;
    this.tab = tab;
    this.isOpen = true;
    this.unreadCount = 0;
    this.autoScroll = true;
    this.pushes = [];
    this.seenSignatures.clear();
    this.revealedBlacklistFloors.clear();
    this.filterType = 'all';
    this.filterUser = null;
    this.filterBanner?.classList.add('hidden');
    this.modalEl?.querySelectorAll('.live-filter-btn').forEach((btn) => {
      btn.classList.toggle('active', (btn.dataset?.filter || 'all') === 'all');
    });
    this.targetAid = null;
    this.targetBoard = null;
    this.targetTitle = '';
    this.targetAuthor = '';
    this.currentArticle = null;
    this.stopPolling();
    this.clearMediaPreviewsAndMiniPlayer();
    this.isCrawlingHistory = false;
    this.isPolling = false;

    if (this.titleEl) {
      this.titleEl.textContent = '載入中...';
      this.titleEl.title = '';
    }
    if (this.boardBadgeEl) {
      this.boardBadgeEl.textContent = 'BBS';
    }
    this.updateStats();
    this.updateUnreadPill();
    this.updateAuthorModeUi();
    this.renderAllPushes();

    this.applyFontSize();

    if (this.modalEl) {
      this.modalEl.classList.remove('hidden');
    }
    this.onStateChange();

    this.sessionGeneration = (this.sessionGeneration || 0) + 1;
    this.oldestCapturedLineNum = null;
    this.oldestCapturedPageNum = null;
    this.hasMoreHistory = false;
    this.canUseGotoPrompt = true;
    this.gotoFailCount = 0;
    this._suppressScrollCheck = false;
    this._suppressLoadEarlier = false;
    this._didInitialScrollToBottom = false;
    this._programmaticScrollToBottom = false;
    this._smoothScrollTimer = null;
    this._lastBottomScrollTop = 0;
    const openGen = this.sessionGeneration;

    // 1. Initial article hydration
    if (initialArticle && Array.isArray(initialArticle.pushList) && initialArticle.pushList.length > 0) {
      if (this.normalizeTitleForMatch(initialArticle.title)) this.targetTitle = initialArticle.title;
      if (initialArticle.author && initialArticle.author.trim() !== 'BBS 使用者') this.targetAuthor = initialArticle.author;
      if (initialArticle.board && initialArticle.board !== 'BBS') this.targetBoard = initialArticle.board;
      if (initialArticle.aid) {
        this.targetAid = initialArticle.aid;
      } else if (initialArticle.articleId) {
        this.targetAid = filenameToAid(initialArticle.articleId);
      }
      this.setArticle(initialArticle);
      void (async () => {
        if (this.detectBbsState(tab.buf) === 'article_list' && tab.isConnected && this.sendToTab && this.getConnectionSession) {
          try {
            const session = await this.getConnectionSession(tab.id);
            if (!session || !this.isOpen || openGen !== this.sessionGeneration) return;
            await this.sendToTab(tab.id, '\r', session);
            await this.waitForScreenCondition(tab, (_l, s) => s === 'reading', {
              timeoutMs: 2500,
              settleMs: 45,
              generation: openGen,
            });
          } catch (_) {}
        }
        if (this.isOpen && openGen === this.sessionGeneration) {
          this.startPolling(tab);
        }
      })();
    } else {
      void this.hydrateArticleAndHistory(tab, openGen);
    }

    // Focus input
    setTimeout(() => {
      this.inputEl?.focus();
    }, 100);
  }

  close() {
    const closingTab = this.tab;
    const canRewindToEof = closingTab && closingTab.isConnected && this.sendToTab && this.getConnectionSession && (() => {
      if (this.detectBbsState(closingTab.buf) !== 'reading') return false;
      const lines = this.getScreenLines(closingTab.buf);
      if (this.isReadingAtEof(lines)) return false;
      const parsed = ArticleParser.parseLines(lines);
      const aidMeta = this.extractAidMetadata(lines);
      return this.matchesTargetArticle({
        ...parsed,
        board: parsed.board || this.getBoardFromScreen(lines, closingTab.buf) || aidMeta.board,
        aid: parsed.aid || aidMeta.aid,
      });
    })();

    this.sessionGeneration = (this.sessionGeneration || 0) + 1;
    this.oldestCapturedLineNum = null;
    this.oldestCapturedPageNum = null;
    this.hasMoreHistory = false;
    this._suppressScrollCheck = false;
    this.stopPolling();
    this.clearMediaPreviewsAndMiniPlayer();
    this._didInitialScrollToBottom = false;
    this._programmaticScrollToBottom = false;
    this._suppressLoadEarlier = false;
    this._lastBottomScrollTop = 0;
    if (this._smoothScrollTimer) {
      clearTimeout(this._smoothScrollTimer);
      this._smoothScrollTimer = null;
    }
    this.isOpen = false;
    this.isCrawlingHistory = false;
    this.isPolling = false;
    this.targetAid = null;
    this.targetBoard = null;
    this.targetTitle = '';
    this.targetAuthor = '';
    this.currentArticle = null;
    this.pushes = [];
    this.seenSignatures.clear();
    this.revealedBlacklistFloors.clear();
    this.filterType = 'all';
    this.filterUser = null;
    this.filterBanner?.classList.add('hidden');
    if (this.streamEl) {
      this.streamEl.innerHTML = '';
    }
    if (this.titleEl) {
      this.titleEl.textContent = '載入中...';
      this.titleEl.title = '';
    }
    if (this.boardBadgeEl) {
      this.boardBadgeEl.textContent = 'BBS';
    }
    this.updateStats();
    this.updateUnreadPill();
    if (this.isPinned) {
      this.isPinned = false;
      this.pinBtn?.classList.remove('active');
      void setAlwaysOnTop(false);
    }
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
    this.onStateChange();

    // Ensure terminal is left at the end of the target article if verified inside it
    if (canRewindToEof) {
      this.getConnectionSession(closingTab.id).then((session) => {
        if (session) void this.sendToTab(closingTab.id, '$', session);
      }).catch(() => {});
    }

    this.tab?.term?.focus?.();
  }

  setArticle(article) {
    const validTitle = this.normalizeTitleForMatch(article.title) ? article.title : '';
    const validBoard = (article.board && article.board !== 'BBS') ? article.board : '';
    this.currentArticle = {
      ...article,
      title: validTitle || this.targetTitle || article.title || '實況文章',
      board: validBoard || this.targetBoard || article.board || 'BBS',
    };
    if (article.aid) {
      this.targetAid = article.aid;
    } else if (article.articleId) {
      this.targetAid = filenameToAid(article.articleId);
    }
    if (validBoard) {
      this.targetBoard = validBoard;
    }
    if (validTitle) {
      this.targetTitle = validTitle;
    }

    const displayTitle = validTitle || this.targetTitle || '實況文章';
    const displayBoard = validBoard || this.targetBoard || 'BBS';
    if (this.titleEl) {
      this.titleEl.textContent = displayTitle;
      this.titleEl.title = displayTitle;
    }
    if (this.boardBadgeEl) {
      this.boardBadgeEl.textContent = displayBoard;
    }

    if (Array.isArray(article.pushList)) {
      for (const p of article.pushList) {
        const sig = this.makeSignature(p);
        if (!this.seenSignatures.has(sig)) {
          this.seenSignatures.add(sig);
          this.pushes.push(p);
        }
      }
    }

    this.renderAllPushes(this.autoScroll);
    this.updateStats();
    this.updateAuthorModeUi();
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  checkIsOp() {
    const opUser = (this.currentArticle?.author || '').split(' ')?.[0]?.trim();
    const myUser = this.getUserId(this.tab) || this.pushHelper?.detectUserId?.(this.tab) || '';
    return Boolean(opUser && myUser && opUser.toLowerCase() === myUser.toLowerCase());
  }

  updateAuthorModeUi() {
    const isOp = this.checkIsOp();
    const pushBtn = this.modalEl?.querySelector('.live-type-btn.push');
    const booBtn = this.modalEl?.querySelector('.live-type-btn.boo');
    const arrowBtn = this.modalEl?.querySelector('.live-type-btn.arrow');

    if (isOp) {
      this.activeType = '3';
      if (pushBtn) {
        pushBtn.disabled = true;
        pushBtn.classList.remove('active');
        pushBtn.title = '原PO推文一律為加註 (→)';
      }
      if (booBtn) {
        booBtn.disabled = true;
        booBtn.classList.remove('active');
        booBtn.title = '原PO推文一律為加註 (→)';
      }
      if (arrowBtn) {
        arrowBtn.classList.add('active');
        arrowBtn.title = '原PO加註 (→)';
      }
    } else {
      if (pushBtn) {
        pushBtn.disabled = false;
        pushBtn.title = '推 (預設)';
      }
      if (booBtn) {
        booBtn.disabled = false;
        booBtn.title = '噓';
      }
    }
  }

  makeSignature(p) {
    return `${p.tag || ''}:${p.user || ''}:${(p.content || '').trim()}:${p.time || ''}`;
  }

  updateStats() {
    let pushCount = 0;
    let booCount = 0;
    let arrowCount = 0;

    for (const p of this.pushes) {
      if (p.tag === '推') pushCount++;
      else if (p.tag === '噓') booCount++;
      else arrowCount++;
    }

    if (this.statPush) this.statPush.textContent = `推 ${pushCount}`;
    if (this.statBoo) this.statBoo.textContent = `噓 ${booCount}`;
    if (this.statArrow) this.statArrow.textContent = `→ ${arrowCount}`;
    if (this.statTotal) this.statTotal.textContent = `共 ${this.pushes.length} 則`;
  }

  startPolling(tab = this.tab) {
    this.stopPolling();
    if (!this.isOpen || this.pollIntervalMs <= 0 || this.isCrawlingHistory) return;
    this.scheduleNextPoll(this.pollIntervalMs, tab);
  }

  scheduleNextPoll(delayMs = this.pollIntervalMs, tab = this.tab) {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.isOpen || this.pollIntervalMs <= 0 || this.isCrawlingHistory) return;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      if (!this.isOpen || this.isCrawlingHistory) return;
      const pollStartedAt = Date.now();
      try {
        await this.pollLatest(tab);
      } finally {
        if (this.isOpen && this.pollIntervalMs > 0 && !this.pollTimer && !this.isCrawlingHistory) {
          const elapsed = Date.now() - pollStartedAt;
          const nextDelay = Math.max(200, this.pollIntervalMs - elapsed);
          this.scheduleNextPoll(nextDelay, tab);
        }
      }
    }, delayMs);
    if (typeof this.pollTimer?.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  restartPolling() {
    this.stopPolling();
    if (this.isOpen && this.pollIntervalMs > 0 && !this.isCrawlingHistory) {
      this.scheduleNextPoll(this.pollIntervalMs, this.tab);
    }
  }

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  updateLoadingStatus(loading, text = '') {
    if (this.pulseBadge) {
      if (loading) {
        this.pulseBadge.innerHTML = `<span class="live-pulse-dot loading"></span>${this.escapeHtml(text || '載入歷史中...')}`;
        this.pulseBadge.title = '正在載入實況文歷史推文與統計...';
      } else if (this.hasMoreHistory) {
        this.pulseBadge.innerHTML = `<span class="live-pulse-dot"></span>實況中 · 載入舊推文`;
        this.pulseBadge.title = '即時更新最新推文，同時背景補齊歷史推文中...';
      } else {
        this.pulseBadge.innerHTML = `<span class="live-pulse-dot"></span>實況中`;
        this.pulseBadge.title = '已載入全部推文，推文實況自動輪詢中';
      }
    }
  }

  getBottomLines(lines, count = 3) {
    const nonEmpty = [];
    for (let r = lines.length - 1; r >= 0 && nonEmpty.length < count; r--) {
      if (lines[r] && lines[r].trim()) {
        nonEmpty.unshift(lines[r]);
      }
    }
    return nonEmpty;
  }

  detectBbsState(buf) {
    const lines = this.getScreenLines(buf);
    if (lines.length === 0) return 'unknown';

    const top = lines.slice(0, Math.min(3, lines.length)).join('\n');
    const bottomPhysical = lines.slice(Math.max(0, lines.length - 3));
    const bottomNonEmpty = this.getBottomLines(lines, 3);
    const bottom = [...new Set([...bottomNonEmpty, ...bottomPhysical])].join('\n');

    if (/從上次(?:閱讀|離開)處繼續|要從上次/.test(bottom)) {
      return 'resume_prompt';
    }

    if (/要直接進入實況模式看新推文嗎/.test(bottom)) {
      return 'live_prompt';
    }

    if (/實況中\s+\d{2}:\d{2}\s+\[\+\d+\]/.test(bottom)) {
      return 'native_live';
    }

    if (/每行最多可容納|編輯文章|請輸入標題|請輸入密碼|請輸入推文|推文確認|確認.*[Yy/Nn]|Ctrl[-+]X|\(Ctrl\+X\)|\^X\s*(?:發表|寄出|存檔)/i.test(bottom)) {
      return 'compose';
    }

    if (/(?:請\s*)?按\s*(?:任意|任何|空白)\s*鍵.*繼續|按回車鍵|按\s*\[RETURN\]\s*繼續/.test(bottom)) {
      return 'waiting_enter';
    }

    if (lines.some((l) => /^(?:【[^】]+】\s*)?(?:請輸入|搜尋)文章代碼(?:\s*[（(]AID[）)])?\s*[:：]\s*#?\s*$/.test(l.trim()))) {
      return 'aid_input';
    }

    if (/^\s*跳至此(?:頁(?:\([^)]*\))?|行)\s*[:：]/m.test(bottom)) {
      return 'goto_prompt';
    }

    // 1. Article List must be checked BEFORE reading to prevent list footer "(h)說明" or titles with push-like words from matching reading.
    let articleRowCount = 0;
    for (let r = 1; r < lines.length - 1; r++) {
      if (/^\s*(?:[>●○◎☆★]\s*)?(?:\d+|[★*])\s+(?:[+爆MmSs~!Xx\d]+\s*)?\d{1,2}\/\d{1,2}\s+[a-zA-Z0-9_-]+/.test(lines[r])) {
        articleRowCount++;
      }
    }

    const hasReadingFooter = /瀏覽\s+第\s*\d+|目前顯示\s*[:：]?\s*第\s*\d+|\(←\/q\)離開|\[←\/q\]離開|主題閱讀|閱讀文章|下面還有喔/.test(bottom);
    const isList = /文章選讀/.test(bottom)
      || /看板[《【]/.test(top)
      || lines.slice(0, 4).some((l) => /編號\s+日\s*期\s+作\s*者/.test(l))
      || (articleRowCount >= 2 && !hasReadingFooter);

    if (isList) return 'article_list';

    if (/看板列表|討論區列表|主功能表|個人設定|網路遊樂場/.test(top)) {
      return 'unknown';
    }

    // 2. Reading state
    const hasPushLine = lines.some((l) => /^\s*[推噓→]\s+[a-zA-Z0-9_-]+\s*[:：]/.test(l));
    const isReading = hasReadingFooter
      || /100%/.test(bottom)
      || lines.slice(0, 5).some((l) => /^\s*(?:作者(?:\s*[:：]\s*|\s+)|標題(?:\s*[:：]\s*|\s+)|時間(?:\s*[:：]\s*|\s+))/.test(l))
      || hasPushLine;

    if (isReading) return 'reading';

    return 'unknown';
  }

  hasArticleHeader(lines) {
    return lines.slice(0, 5).some((l) =>
      /^\s*(?:作者(?:\s*[:：]\s*|\s+)|標題(?:\s*[:：]\s*|\s+)|看板(?:\s*[:：]\s*|\s+))/.test(l)
    );
  }

  getBoardFromScreen(lines, buf) {
    const fromBuf = detectCurrentBoard(buf);
    if (fromBuf) return fromBuf;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const b = boardFromHeaderLine(lines[i]);
      if (b) return b;
    }
    return null;
  }

  parseArticleListCursor(lines, buf) {
    const parseRow = (rowStr) => {
      const m = rowStr.match(/^\s*(?:[>●]\s*)?(?:\d+|[★*])\s+(?:[+爆MmSs~!Xx\d]+\s*)?\d{1,2}\/\d{1,2}\s+([a-zA-Z0-9_-]+)\s+(.*)$/);
      if (!m) return null;
      const author = m[1].trim();
      const rawRest = m[2].trim();
      const title = rawRest.replace(/^(?:[□◆◇★轉])\s*/, '').trim();
      return { author, title, rawRest };
    };

    for (let r = 1; r < lines.length - 1; r++) {
      if (/^\s*[>●]/.test(lines[r])) {
        const parsed = parseRow(lines[r]);
        if (parsed) return { ...parsed, row: r };
      }
    }

    if (buf && Number.isInteger(buf.cur_y) && buf.cur_y >= 1 && buf.cur_y < lines.length - 1) {
      const parsed = parseRow(lines[buf.cur_y]);
      if (parsed) return { ...parsed, row: buf.cur_y };
    }

    return null;
  }

  normalizeTitleForMatch(title) {
    if (!title || typeof title !== 'string') return '';
    const trimmed = title.trim();
    if (trimmed === 'BBS 文章' || trimmed === '實況文章') return '';
    return trimmed
      .replace(/\u3000/g, ' ')
      .replace(/^(?:[□◆◇★●>轉])\s*/, '')
      .replace(/^R:\s*/i, 'Re: ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  titlesMatch(a, b) {
    const na = this.normalizeTitleForMatch(a);
    const nb = this.normalizeTitleForMatch(b);
    if (!na || !nb) return true;
    if (na === nb) return true;
    const minLen = Math.min(na.length, nb.length);
    if (minLen >= 6 && (na.startsWith(nb) || nb.startsWith(na))) return true;
    const prefixLen = Math.min(minLen, 14);
    return prefixLen >= 8 && na.slice(0, prefixLen) === nb.slice(0, prefixLen);
  }

  authorsMatch(a, b) {
    if (!a || !b) return true;
    const isPlaceholder = (s) => !s || s.trim() === 'BBS 使用者';
    if (isPlaceholder(a) || isPlaceholder(b)) return true;
    const cleanAuthor = (s) => s.trim().split(/[\s(（]/)[0].toLowerCase();
    const aa = cleanAuthor(a);
    const bb = cleanAuthor(b);
    if (!aa || !bb) return true;
    if (aa === bb) return true;
    if (Math.min(aa.length, bb.length) >= 4) {
      return aa.startsWith(bb) || bb.startsWith(aa);
    }
    return false;
  }

  extractAidMetadata(lines) {
    let aid = null;
    let board = null;
    for (const line of lines) {
      const urlMatch = line.match(/(?:※\s*)?文章網址\s*[:：]\s*(https?:\/\/(?:www\.)?ptt\.cc\/bbs\/([a-zA-Z0-9_-]{1,32})\/(M\.\d{1,10}\.A(?:\.[0-9A-Fa-f]{3})?)\.html)/i);
      if (urlMatch) {
        const parsed = parseAidInput(urlMatch[1]);
        if (parsed.isValid) {
          aid = parsed.aid;
          board = parsed.board || board;
          break;
        }
      }
      const aidMatch = line.match(/(?:文章代碼(?:\(AID\))?|AID)\s*[:：]\s*#?([0-9a-zA-Z_-]{8})(?:\s*[（(]([a-zA-Z0-9_-]{1,32})[）)])?/i);
      if (aidMatch) {
        const parsed = parseAidInput(`#${aidMatch[1]}`, aidMatch[2] || null);
        if (parsed.isValid) {
          aid = parsed.aid;
          if (parsed.board) board = parsed.board;
        }
      }
    }
    return { aid, board };
  }

  matchesTargetArticle(candidate = {}) {
    if (!candidate) return true;
    const targetAid = this.targetAid || this.currentArticle?.aid;
    const targetBoard = this.targetBoard || (this.currentArticle?.board !== 'BBS' ? this.currentArticle?.board : null);
    const targetAuthor = this.targetAuthor || this.currentArticle?.author;
    const targetTitle = this.normalizeTitleForMatch(this.targetTitle || this.currentArticle?.title)
      ? (this.targetTitle || this.currentArticle?.title)
      : '';

    if (targetAid && candidate.aid) {
      const cleanTarget = targetAid.replace(/^#/, '').trim();
      const cleanCand = String(candidate.aid).replace(/^#/, '').trim();
      if (cleanTarget && cleanCand && cleanTarget !== cleanCand) return false;
    }
    if (targetBoard && candidate.board && candidate.board !== 'BBS') {
      if (targetBoard.toLowerCase() !== candidate.board.trim().toLowerCase()) return false;
    }
    if (targetAuthor && candidate.author) {
      if (!this.authorsMatch(targetAuthor, candidate.author)) return false;
    }
    if (targetTitle && candidate.title) {
      if (!this.titlesMatch(targetTitle, candidate.title)) return false;
    }
    return true;
  }

  lockArticleIdentity(meta = {}) {
    if (this.normalizeTitleForMatch(meta.title) && !this.targetTitle) {
      this.targetTitle = meta.title;
    }
    if (meta.board && meta.board !== 'BBS' && !this.targetBoard) {
      this.targetBoard = meta.board;
    }
    if (meta.author && meta.author.trim() !== 'BBS 使用者' && !this.targetAuthor) {
      this.targetAuthor = meta.author;
    }
    const resolvedAid = meta.aid || (meta.articleId ? filenameToAid(meta.articleId) : null);
    if (resolvedAid && !this.targetAid) {
      this.targetAid = resolvedAid;
    }
    if (this.titleEl && this.targetTitle) {
      this.titleEl.textContent = this.targetTitle;
      this.titleEl.title = this.targetTitle;
    }
    if (this.boardBadgeEl && this.targetBoard) {
      this.boardBadgeEl.textContent = this.targetBoard;
    }
  }

  extractPageLineRange(lines) {
    const candidates = this.getBottomLines(lines, 4);
    for (let r = candidates.length - 1; r >= 0; r--) {
      const line = candidates[r] || '';
      const lineMatch = line.match(/目前顯示\s*[:：]?\s*第\s*0*(\d+)\s*[~～-]\s*0*(\d+)\s*行/);
      if (lineMatch) {
        return {
          startNum: parseInt(lineMatch[1], 10),
          endNum: parseInt(lineMatch[2], 10),
        };
      }
    }
    return null;
  }

  extractPageProgress(lines) {
    const candidates = this.getBottomLines(lines, 3);
    for (let r = candidates.length - 1; r >= 0; r--) {
      const footer = candidates[r] || '';
      const pageMatch = footer.match(/瀏覽\s+第\s*(\d+)\s*(?:\/\s*(\d+))?\s*頁/);
      const hasPct100 = footer.includes('100%');
      if (pageMatch || hasPct100) {
        const curPage = pageMatch ? parseInt(pageMatch[1], 10) : null;
        const totalPages = pageMatch?.[2] ? parseInt(pageMatch[2], 10) : null;
        const isLastPage = Boolean(hasPct100 || (curPage && totalPages && curPage >= totalPages));
        return { curPage, totalPages, isLastPage, raw: footer };
      }
    }
    return { curPage: null, totalPages: null, isLastPage: false, raw: lines[lines.length - 1] || '' };
  }

  isReadingAtEof(lines) {
    return this.extractPageProgress(lines).isLastPage;
  }

  recordScreenLines(lines, allLinesMap, fallbackLines) {
    const contentRows = lines.slice(0, Math.max(0, lines.length - 1));
    const range = this.extractPageLineRange(lines);
    if (range) {
      contentRows.forEach((txt, idx) => {
        allLinesMap.set(range.startNum + idx, txt);
      });
    } else if (fallbackLines) {
      fallbackLines.push(...contentRows);
    }
    const { aid, board } = this.extractAidMetadata(lines);
    if (aid || board) {
      const cand = { aid, board };
      if (this.matchesTargetArticle(cand)) {
        this.lockArticleIdentity(cand);
      }
    }
    return range;
  }

  async hydrateArticleAndHistory(tab, generation = this.sessionGeneration) {
    if (!this.isOpen || generation !== this.sessionGeneration || !tab || !tab.isConnected || !this.sendToTab || !this.getConnectionSession) return;
    this.isCrawlingHistory = true;
    this.updateLoadingStatus(true, '載入中...');

    try {
      const session = await this.getConnectionSession(tab.id);
      if (!session || !this.isOpen || generation !== this.sessionGeneration) return;
      const send = (data) => this.sendToTab(tab.id, data, session);

      // 0. If opened from article list, lock cursor metadata immediately & enter with strict wait
      let initialState = this.detectBbsState(tab.buf);
      if (initialState === 'article_list') {
        const listLines = this.getScreenLines(tab.buf);
        const listBoard = this.getBoardFromScreen(listLines, tab.buf);
        const cursor = this.parseArticleListCursor(listLines, tab.buf);
        this.lockArticleIdentity({
          board: listBoard,
          author: cursor?.author,
          title: cursor?.title,
        });

        await send('\r');
        const entered = await this.waitForScreenCondition(
          tab,
          (_l, s) => s === 'reading' || s === 'resume_prompt' || s === 'live_prompt',
          { timeoutMs: 2500, settleMs: 45, generation }
        );
        if (!entered || !this.isOpen || generation !== this.sessionGeneration) return;

        let curEnterState = this.detectBbsState(tab.buf);
        while (curEnterState === 'resume_prompt' || curEnterState === 'live_prompt') {
          await send('n\r');
          const resolved = await this.waitForScreenCondition(
            tab,
            (_l, s) => s === 'reading' || s === 'resume_prompt' || s === 'live_prompt',
            { timeoutMs: 2000, settleMs: 45, generation }
          );
          if (!resolved || !this.isOpen || generation !== this.sessionGeneration) return;
          curEnterState = this.detectBbsState(tab.buf);
        }
        initialState = this.detectBbsState(tab.buf);
      } else if (initialState === 'resume_prompt' || initialState === 'live_prompt') {
        await send('n\r');
        const resumed = await this.waitForBbsState(tab, 'reading', 2000, generation);
        if (!resumed || !this.isOpen || generation !== this.sessionGeneration) return;
        initialState = this.detectBbsState(tab.buf);
      } else if (initialState === 'goto_prompt') {
        await send('\r');
        const recovered = await this.waitForBbsState(tab, 'reading', 1200, generation);
        if (!recovered || !this.isOpen || generation !== this.sessionGeneration) return;
        initialState = this.detectBbsState(tab.buf);
      }

      if (initialState !== 'reading') {
        if (this.titleEl && !this.targetTitle) {
          this.titleEl.textContent = '請先進入文章畫面';
        }
        return;
      }

      // 1. Check if current screen already has the article header; otherwise rewind to Page 1 cleanly
      let screen = this.getScreenLines(tab.buf);
      if (!this.hasArticleHeader(screen)) {
        if (this.titleEl && !this.targetTitle) this.titleEl.textContent = '📖 正在取得文章資訊...';
        await send('\x1b[1~');
        const atTop = await this.waitForScreenCondition(
          tab,
          (lines, s) => s === 'reading' && (this.hasArticleHeader(lines) || this.extractPageProgress(lines).curPage === 1),
          { timeoutMs: 2500, settleMs: 55, generation }
        );
        if (!this.isOpen || generation !== this.sessionGeneration) return;
        if (!atTop && this.detectBbsState(tab.buf) !== 'reading') return;
        screen = this.getScreenLines(tab.buf);
      }

      // Parse & lock header metadata from Page 1
      const headerParsed = ArticleParser.parseLines(screen);
      const screenBoard = this.getBoardFromScreen(screen, tab.buf);
      if (!headerParsed.board && screenBoard) headerParsed.board = screenBoard;
      const aidMeta = this.extractAidMetadata(screen);
      if (aidMeta.aid && !headerParsed.aid) headerParsed.aid = aidMeta.aid;
      if (aidMeta.board && !headerParsed.board) headerParsed.board = aidMeta.board;

      const headerMatch = this.matchesTargetArticle(headerParsed);
      if (!headerMatch) {
        return;
      }
      this.lockArticleIdentity(headerParsed);
      if (this.titleEl && !this.targetTitle) {
        this.titleEl.textContent = '實況文章';
      }

      // 2. Determine total pages from Page 1 footer.
      // NOTE: On huge PTT articles, pmore omits "/total" on Page 1 ("瀏覽 第 1 頁 (  0%)"),
      // returning totalPages === null. Treat null (when not already at EOF) as a large thread
      // so we jump straight to EOF ($) and PageUp with '\x1b[5~' instead of crawling 34 Spaces.
      const initialProg = this.extractPageProgress(screen);
      const isKnownShort = initialProg.isLastPage || (initialProg.totalPages != null && initialProg.totalPages <= 15);

      if (isKnownShort) {
        const allLinesMap = new Map();
        const fallbackLines = [];
        this.recordScreenLines(screen, allLinesMap, fallbackLines);
        let pageCount = 1;

        while (pageCount < 20 && this.isOpen && generation === this.sessionGeneration) {
          const curScreen = this.getScreenLines(tab.buf);
          const curState = this.detectBbsState(tab.buf);
          if (curState !== 'reading') break;

          const curProg = this.extractPageProgress(curScreen);
          if (curProg.isLastPage) break;

          const curRange = this.extractPageLineRange(curScreen);
          const curHash = curScreen.slice(0, Math.max(0, curScreen.length - 1)).join('\n');

          await send(' ');
          const advanced = await this.waitForScreenCondition(
            tab,
            (lines, s) => {
              if (s !== 'reading') return true; // Exit wait immediately if state unexpectedly left reading
              const nextProg = this.extractPageProgress(lines);
              const nextRange = this.extractPageLineRange(lines);
              const nextHash = lines.slice(0, Math.max(0, lines.length - 1)).join('\n');
              if (curRange && nextRange && nextRange.startNum !== curRange.startNum) return true;
              if (curProg.curPage && nextProg.curPage && nextProg.curPage !== curProg.curPage) return true;
              if (nextProg.isLastPage && !curProg.isLastPage) return true;
              return nextHash !== curHash;
            },
            { timeoutMs: 2000, settleMs: 50, generation }
          );
          if (!advanced || !this.isOpen || generation !== this.sessionGeneration) break;
          if (this.detectBbsState(tab.buf) !== 'reading') break;

          const nextScreen = this.getScreenLines(tab.buf);
          const nextHash = nextScreen.slice(0, Math.max(0, nextScreen.length - 1)).join('\n');
          if (nextHash === curHash) break;

          this.recordScreenLines(nextScreen, allLinesMap, fallbackLines);
          pageCount++;
        }

        if (!this.isOpen || generation !== this.sessionGeneration) return;
        const fullLines = allLinesMap.size > 0
          ? Array.from(allLinesMap.keys()).sort((a, b) => a - b).map((k) => allLinesMap.get(k))
          : fallbackLines;
        const fullParsed = ArticleParser.parseLines(fullLines);
        if (!this.matchesTargetArticle(fullParsed)) return;
        if (this.targetTitle) fullParsed.title = this.targetTitle;
        if (this.targetBoard) fullParsed.board = this.targetBoard;
        if (this.targetAuthor && !fullParsed.author) fullParsed.author = this.targetAuthor;
        if (allLinesMap.size > 0) {
          this.oldestCapturedLineNum = Math.min(...allLinesMap.keys());
        }
        this.oldestCapturedPageNum = 1;
        this.hasMoreHistory = false;
        this.setArticle(fullParsed);
      } else {
        // Large or unknown-page-count thread:
        // Jump directly to EOF with '$' and strictly wait for 100% EOF, then step back with KEY_PGUP ('\x1b[5~').
        // IMPORTANT: never send 'b' inside pmore (on PTT 'b' = prev article in list!).
        const eofLinesMap = new Map();
        const fallbackLines = [];

        await send('$');
        const eofOk = await this.waitForReadingEof(tab, 2500, generation);
        if (!eofOk || !this.isOpen || generation !== this.sessionGeneration) return;
        if (this.detectBbsState(tab.buf) !== 'reading') return;

        let curScreen = this.getScreenLines(tab.buf);
        const eofParsed = ArticleParser.parseLines(curScreen);
        const eofAid = this.extractAidMetadata(curScreen);
        if (!this.matchesTargetArticle({
          ...eofParsed,
          board: eofParsed.board || this.getBoardFromScreen(curScreen, tab.buf) || eofAid.board,
          aid: eofParsed.aid || eofAid.aid,
        })) {
          return;
        }
        let curRange = this.recordScreenLines(curScreen, eofLinesMap, fallbackLines);
        const eofProg = this.extractPageProgress(curScreen);
        let minPageSeen = eofProg.curPage || null;
        const maxBackSteps = (eofProg.totalPages != null && eofProg.totalPages <= 15)
          ? Math.max(0, eofProg.totalPages - 1)
          : 8;

        for (let step = 0; step < maxBackSteps && this.isOpen && generation === this.sessionGeneration; step++) {
          const curProg = this.extractPageProgress(curScreen);
          if (curProg.curPage === 1) {
            minPageSeen = 1;
            break;
          }
          const prevStart = curRange?.startNum ?? null;
          const prevPage = curProg.curPage ?? null;
          const prevHash = curScreen.slice(0, Math.max(0, curScreen.length - 1)).join('\n');

          await send('\x1b[5~');
          const movedBack = await this.waitForScreenCondition(
            tab,
            (lines, s) => {
              if (s !== 'reading') return true;
              const nr = this.extractPageLineRange(lines);
              const np = this.extractPageProgress(lines);
              const nh = lines.slice(0, Math.max(0, lines.length - 1)).join('\n');
              if (prevStart != null && nr && nr.startNum < prevStart) return true;
              if (prevPage != null && np.curPage && np.curPage < prevPage) return true;
              return nh !== prevHash && prevStart == null;
            },
            { timeoutMs: 2000, settleMs: 50, generation }
          );
          if (!movedBack || !this.isOpen || generation !== this.sessionGeneration) break;
          if (this.detectBbsState(tab.buf) !== 'reading') break;

          const nextScreen = this.getScreenLines(tab.buf);
          const nextParsed = ArticleParser.parseLines(nextScreen);
          const nextAid = this.extractAidMetadata(nextScreen);
          if (!this.matchesTargetArticle({
            ...nextParsed,
            board: nextParsed.board || this.getBoardFromScreen(nextScreen, tab.buf) || nextAid.board,
            aid: nextParsed.aid || nextAid.aid,
          })) {
            break;
          }

          curScreen = nextScreen;
          curRange = this.recordScreenLines(curScreen, eofLinesMap, fallbackLines);
          const nextProg = this.extractPageProgress(curScreen);
          if (nextProg.curPage && (!minPageSeen || nextProg.curPage < minPageSeen)) {
            minPageSeen = nextProg.curPage;
          }
        }

        if (!this.isOpen || generation !== this.sessionGeneration) return;

        // Return terminal cleanly to EOF if verified still in target article
        if (this.detectBbsState(tab.buf) === 'reading' && !this.isReadingAtEof(this.getScreenLines(tab.buf))) {
          await send('$');
          await this.waitForReadingEof(tab, 2000, generation);
        }

        if (!this.isOpen || generation !== this.sessionGeneration) return;
        const recentLines = eofLinesMap.size > 0
          ? Array.from(eofLinesMap.keys()).sort((a, b) => a - b).map((k) => eofLinesMap.get(k))
          : this.getScreenLines(tab.buf);
        const parsed = ArticleParser.parseLines(recentLines);
        if (!this.matchesTargetArticle(parsed)) return;
        if (this.targetTitle) parsed.title = this.targetTitle;
        if (this.targetBoard) parsed.board = this.targetBoard;
        if (this.targetAuthor && !parsed.author) parsed.author = this.targetAuthor;
        if (eofLinesMap.size > 0) {
          this.oldestCapturedLineNum = Math.min(...eofLinesMap.keys());
        }
        this.oldestCapturedPageNum = minPageSeen;
        this.hasMoreHistory = Boolean(
          this.oldestCapturedLineNum &&
          this.oldestCapturedLineNum > 1 &&
          (!minPageSeen || minPageSeen > 1)
        );
        this.setArticle(parsed);
      }
    } catch (err) {
      console.warn('[LiveChat] hydrate history error:', err);
    } finally {
      if (generation === this.sessionGeneration) {
        this.isCrawlingHistory = false;
        this.updateLoadingStatus(false);
        if (this.isOpen && tab.isConnected && this.detectBbsState(tab.buf) === 'reading' && !this.isReadingAtEof(this.getScreenLines(tab.buf))) {
          try {
            const session = await this.getConnectionSession(tab.id);
            if (session && this.isOpen && generation === this.sessionGeneration) {
              await this.sendToTab(tab.id, '$', session);
              await this.waitForReadingEof(tab, 1500, generation);
            }
          } catch (_) {}
        }
        if (this.isOpen && this.pollIntervalMs > 0 && generation === this.sessionGeneration) {
          this.startPolling(tab);
        }
      }
    }
  }

  prependHistoricalPushes(pushList) {
    if (!Array.isArray(pushList) || pushList.length === 0) return 0;

    const newEarlier = [];
    for (const p of pushList) {
      const sig = this.makeSignature(p);
      if (!this.seenSignatures.has(sig)) {
        this.seenSignatures.add(sig);
        newEarlier.push(p);
      }
    }
    if (newEarlier.length === 0) return 0;

    this.pushes.unshift(...newEarlier);
    for (let i = 0; i < this.pushes.length; i++) {
      this.pushes[i].floor = i + 1;
    }

    const container = this.scrollContainer;
    if (this._didInitialScrollToBottom && !this._programmaticScrollToBottom) {
      this.syncAutoScrollFromContainer();
    }
    const wasAtBottom = this.autoScroll;
    const oldScrollHeight = container?.scrollHeight || 0;
    const oldScrollTop = container?.scrollTop || 0;

    if (this.streamEl && typeof this.streamEl.insertBefore === 'function' && typeof document?.createDocumentFragment === 'function') {
      const fragment = document.createDocumentFragment();
      for (const p of newEarlier) {
        if (!this.matchesFilter(p)) continue;
        const el = this.createPushElement(p, p.floor || 1);
        if (el) fragment.appendChild(el);
      }
      const welcomeEl = this.streamEl.querySelector?.('.live-chat-welcome-card') || null;
      const insertRef = welcomeEl ? welcomeEl.nextSibling : this.streamEl.firstChild;
      this.streamEl.insertBefore(fragment, insertRef);
    } else {
      this.renderAllPushes(false);
    }

    if (container) {
      this._suppressLoadEarlier = true;
      if (wasAtBottom) {
        this.scrollToBottom();
        this.autoScroll = true;
      } else {
        const delta = container.scrollHeight - oldScrollHeight;
        container.scrollTop = oldScrollTop + Math.max(0, delta);
      }
      const release = setTimeout(() => {
        this._suppressLoadEarlier = false;
      }, 40);
      release?.unref?.();
    }

    this.updateStats();
    return newEarlier.length;
  }

  parseScreenLinesSafely(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return ArticleParser.parseLines(lines);
    }
    const range = this.extractPageLineRange(lines);
    const prog = this.extractPageProgress(lines);
    const definitelyMidArticle =
      (range && range.startNum > 1) || (prog && prog.curPage != null && prog.curPage > 1);
    return ArticleParser.parseLines(definitelyMidArticle ? ['', ...lines] : lines);
  }

  async crawlBackwardBatch(tab, session, generation, maxPages = 8) {
    if (!this.isOpen || generation !== this.sessionGeneration || !tab?.buf || !session || !this.sendToTab) return false;
    if (!this.hasMoreHistory || !this.oldestCapturedLineNum || this.oldestCapturedLineNum <= 1) {
      this.hasMoreHistory = false;
      this.updateLoadingStatus(false);
      return false;
    }

    let entryState = this.detectBbsState(tab.buf);
    if (entryState !== 'reading' && entryState !== 'goto_prompt') return false;

    const verifyCurrentTarget = () => {
      if (this.detectBbsState(tab.buf) !== 'reading') return false;
      const lines = this.getScreenLines(tab.buf);
      const parsed = this.parseScreenLinesSafely(lines);
      const aidMeta = this.extractAidMetadata(lines);
      return this.matchesTargetArticle({
        ...parsed,
        board: parsed.board || this.getBoardFromScreen(lines, tab.buf) || aidMeta.board,
        aid: parsed.aid || aidMeta.aid,
      });
    };

    if (entryState === 'reading' && !verifyCurrentTarget()) return false;

    const batchLinesMap = new Map();
    const fallbackLines = [];
    let reachedTop = false;
    let minPageSeen = this.oldestCapturedPageNum || null;

    if (this.canUseGotoPrompt) {
      const targetLine = Math.max(1, this.oldestCapturedLineNum - 20);
      const beforeJumpRange = entryState === 'reading'
        ? this.extractPageLineRange(this.getScreenLines(tab.buf))
        : null;
      const beforeJumpStart = beforeJumpRange?.startNum ?? Infinity;

      let inGoto = entryState === 'goto_prompt';
      if (!inGoto) {
        await this.sendToTab(tab.id, ':', session);
        inGoto = await this.waitForBbsState(tab, 'goto_prompt', 2000, generation);
        if (!this.isOpen || generation !== this.sessionGeneration) return false;
      }

      if (!inGoto) {
        if (this.detectBbsState(tab.buf) === 'goto_prompt') {
          await this.sendToTab(tab.id, '\r', session);
          await this.waitForBbsState(tab, 'reading', 1200, generation);
        } else {
          this.gotoFailCount = (this.gotoFailCount || 0) + 1;
          if (this.gotoFailCount >= 5) {
            this.canUseGotoPrompt = false;
          }
        }
        return false;
      }

      await this.sendToTab(tab.id, `${targetLine}\r`, session);
      const jumped = await this.waitForScreenCondition(
        tab,
        (lines, s) => {
          if (s !== 'reading') return false;
          const nr = this.extractPageLineRange(lines);
          const np = this.extractPageProgress(lines);
          return Boolean(
            (nr && (nr.startNum <= targetLine + 35 || (Number.isFinite(beforeJumpStart) && nr.startNum < beforeJumpStart))) ||
            np.curPage === 1
          );
        },
        { timeoutMs: 2500, settleMs: 45, generation }
      );
      if (!this.isOpen || generation !== this.sessionGeneration) return false;

      if (!jumped) {
        if (this.detectBbsState(tab.buf) === 'goto_prompt') {
          await this.sendToTab(tab.id, '\r', session);
          await this.waitForBbsState(tab, 'reading', 1200, generation);
        }
        this.gotoFailCount = (this.gotoFailCount || 0) + 1;
        if (this.gotoFailCount >= 5) {
          this.canUseGotoPrompt = false;
        }
        return false;
      }
      this.gotoFailCount = 0;
      if (!verifyCurrentTarget()) return false;
    } else if (entryState === 'goto_prompt') {
      await this.sendToTab(tab.id, '\r', session);
      const cleared = await this.waitForBbsState(tab, 'reading', 1200, generation);
      if (!cleared || !this.isOpen || generation !== this.sessionGeneration || !verifyCurrentTarget()) return false;
    }

    let curScreen = this.getScreenLines(tab.buf);
    let curRange = this.recordScreenLines(curScreen, batchLinesMap, fallbackLines);
    const startProg = this.extractPageProgress(curScreen);
    if (startProg.curPage && (!minPageSeen || startProg.curPage < minPageSeen)) {
      minPageSeen = startProg.curPage;
    }
    if (startProg.curPage === 1 || (curRange && curRange.startNum <= 1)) {
      reachedTop = true;
    }

    for (let step = 0; !reachedTop && step < maxPages && this.isOpen && generation === this.sessionGeneration; step++) {
      if (this.isSending) break;
      const curProg = this.extractPageProgress(curScreen);
      if (curProg.curPage === 1 || (curRange && curRange.startNum <= 1)) {
        reachedTop = true;
        minPageSeen = 1;
        break;
      }
      const prevStart = curRange?.startNum ?? null;
      const prevPage = curProg.curPage ?? null;
      const prevHash = curScreen.slice(0, Math.max(0, curScreen.length - 1)).join('\n');

      await this.sendToTab(tab.id, '\x1b[5~', session);
      const moved = await this.waitForScreenCondition(
        tab,
        (lines, s) => {
          if (s !== 'reading') return true;
          const nr = this.extractPageLineRange(lines);
          const np = this.extractPageProgress(lines);
          const nh = lines.slice(0, Math.max(0, lines.length - 1)).join('\n');
          if (prevStart != null && nr && nr.startNum < prevStart) return true;
          if (prevPage != null && np.curPage && np.curPage < prevPage) return true;
          return nh !== prevHash && prevStart == null;
        },
        { timeoutMs: 1800, settleMs: 50, generation }
      );
      if (!moved || !this.isOpen || generation !== this.sessionGeneration) break;
      if (!verifyCurrentTarget()) break;

      curScreen = this.getScreenLines(tab.buf);
      curRange = this.recordScreenLines(curScreen, batchLinesMap, fallbackLines);
      const stepProg = this.extractPageProgress(curScreen);
      if (stepProg.curPage && (!minPageSeen || stepProg.curPage < minPageSeen)) {
        minPageSeen = stepProg.curPage;
      }
      if (stepProg.curPage === 1 || (curRange && curRange.startNum <= 1)) {
        reachedTop = true;
      }
    }

    if (this.isOpen && generation === this.sessionGeneration && verifyCurrentTarget() && !this.isReadingAtEof(this.getScreenLines(tab.buf))) {
      await this.sendToTab(tab.id, '$', session);
      await this.waitForReadingEof(tab, 2000, generation);
    }

    if (!this.isOpen || generation !== this.sessionGeneration) return false;

    const sortedKeys = batchLinesMap.size > 0
      ? Array.from(batchLinesMap.keys()).sort((a, b) => a - b)
      : [];
    const batchLines = sortedKeys.length > 0
      ? sortedKeys.map((k) => batchLinesMap.get(k))
      : fallbackLines;

    if (batchLines.length > 0) {
      const startsAfterHeader = sortedKeys.length > 0 && sortedKeys[0] > 1;
      const parsed = ArticleParser.parseLines(startsAfterHeader ? ['', ...batchLines] : batchLines);
      if (startsAfterHeader || this.matchesTargetArticle(parsed)) {
        if (sortedKeys.length > 0) {
          this.oldestCapturedLineNum = Math.min(this.oldestCapturedLineNum ?? Infinity, sortedKeys[0]);
        }
        this.oldestCapturedPageNum = minPageSeen;
        if (reachedTop || (sortedKeys.length > 0 && sortedKeys[0] <= 1) || minPageSeen === 1) {
          this.hasMoreHistory = false;
        }
        this.prependHistoricalPushes(parsed.pushList || []);
        this.updateLoadingStatus(false);
        return true;
      }
    }
    return false;
  }

  async loadEarlierPushes(tab = this.tab) {
    if (!this.isOpen || !tab || !tab.isConnected || this.isSending || this.isPolling || this.isCrawlingHistory || !this.hasMoreHistory) return;
    const gen = this.sessionGeneration;
    this.isCrawlingHistory = true;

    try {
      if (!this.sendToTab || !this.getConnectionSession) return;
      const session = await this.getConnectionSession(tab.id);
      if (!session || !this.isOpen || gen !== this.sessionGeneration) return;

      await this.crawlBackwardBatch(tab, session, gen, 6);
    } catch (err) {
      console.warn('[LiveChat] loadEarlierPushes error:', err);
    } finally {
      if (gen === this.sessionGeneration) {
        this.isCrawlingHistory = false;
      }
    }
  }

  waitForScreenCondition(tab, predicate, { timeoutMs = 2000, settleMs = 45, requireUpdate = false, generation = this.sessionGeneration } = {}) {
    return new Promise((resolve) => {
      if (!tab?.buf) {
        resolve(false);
        return;
      }

      let resolved = false;
      let sawUpdate = false;
      let settleTimer = null;
      const orig = tab.buf.onUpdate;

      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(maxTimer);
        if (settleTimer) clearTimeout(settleTimer);
        if (tab?.buf) tab.buf.onUpdate = orig;
        resolve(result);
      };

      const maxTimer = setTimeout(() => finish(false), timeoutMs);
      maxTimer?.unref?.();

      const evaluate = () => {
        if (resolved) return;
        if (!this.isOpen || generation !== this.sessionGeneration) {
          finish(false);
          return;
        }
        if (requireUpdate && !sawUpdate) return;

        const lines = this.getScreenLines(tab.buf);
        const state = this.detectBbsState(tab.buf);
        if (predicate(lines, state)) {
          if (settleMs <= 0) {
            finish(true);
            return;
          }
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            if (resolved) return;
            if (!this.isOpen || generation !== this.sessionGeneration) {
              finish(false);
              return;
            }
            const stableLines = this.getScreenLines(tab.buf);
            const stableState = this.detectBbsState(tab.buf);
            if (predicate(stableLines, stableState)) {
              finish(true);
            }
          }, settleMs);
          settleTimer?.unref?.();
        } else if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
      };

      tab.buf.onUpdate = () => {
        if (orig) orig();
        sawUpdate = true;
        evaluate();
      };

      if (!requireUpdate) {
        evaluate();
      }
    });
  }

  waitForBbsState(tab, targetState, maxWaitMs = 1500, generation = this.sessionGeneration) {
    return this.waitForScreenCondition(tab, (_lines, state) => state === targetState, {
      timeoutMs: maxWaitMs,
      settleMs: 45,
      generation,
    });
  }

  waitForArticleList(tab, maxWaitMs = 1500, generation = this.sessionGeneration) {
    return this.waitForBbsState(tab, 'article_list', maxWaitMs, generation);
  }

  waitForReadingEof(tab, maxWaitMs = 2500, generation = this.sessionGeneration) {
    return this.waitForScreenCondition(
      tab,
      (lines, state) => state === 'reading' && this.isReadingAtEof(lines),
      {
        timeoutMs: maxWaitMs,
        settleMs: 55,
        generation,
      }
    );
  }

  async jumpToTargetAidInList(tab, session, generation = this.sessionGeneration) {
    if (!this.isOpen || generation !== this.sessionGeneration || !tab?.buf || !session || !this.sendToTab) return false;
    const aid = this.targetAid || this.currentArticle?.aid;
    const cleanAid = aid ? aid.replace(/^#/, '').trim() : null;
    if (!cleanAid || cleanAid.length !== 8) return false;
    if (this.detectBbsState(tab.buf) !== 'article_list') return false;

    const currentBoard = this.getBoardFromScreen(this.getScreenLines(tab.buf), tab.buf);
    if (this.targetBoard && currentBoard && currentBoard.toLowerCase() !== this.targetBoard.toLowerCase()) {
      return false;
    }

    await this.sendToTab(tab.id, '#', session);
    const inAidPrompt = await this.waitForBbsState(tab, 'aid_input', 1500, generation);
    if (!inAidPrompt || !this.isOpen || generation !== this.sessionGeneration) return false;

    await this.sendToTab(tab.id, `${cleanAid}\r`, session);
    const backToList = await this.waitForBbsState(tab, 'article_list', 2000, generation);
    if (!backToList || !this.isOpen || generation !== this.sessionGeneration) return false;

    const lines = this.getScreenLines(tab.buf);
    const boardAfter = this.getBoardFromScreen(lines, tab.buf);
    const cursor = this.parseArticleListCursor(lines, tab.buf);
    return this.matchesTargetArticle({
      board: boardAfter,
      author: cursor?.author,
      title: cursor?.title,
    });
  }

  async ensureInTargetArticle(tab, session, generation = this.sessionGeneration) {
    if (!tab || !tab.buf) return false;
    let state = this.detectBbsState(tab.buf);
    if (state === 'goto_prompt' && session && this.sendToTab) {
      await this.sendToTab(tab.id, '\r', session);
      await this.waitForBbsState(tab, 'reading', 1200, generation);
      state = this.detectBbsState(tab.buf);
    }
    if (state === 'reading') {
      const lines = this.getScreenLines(tab.buf);
      const parsed = this.parseScreenLinesSafely(lines);
      const aidMeta = this.extractAidMetadata(lines);
      return this.matchesTargetArticle({
        ...parsed,
        board: parsed.board || this.getBoardFromScreen(lines, tab.buf) || aidMeta.board,
        aid: parsed.aid || aidMeta.aid,
      });
    }

    if (!session || !this.sendToTab) return false;

    if (state === 'article_list') {
      const lines = this.getScreenLines(tab.buf);
      const board = this.getBoardFromScreen(lines, tab.buf);
      const cursor = this.parseArticleListCursor(lines, tab.buf);
      const hasKnownAid = Boolean(this.targetAid || this.currentArticle?.aid);
      let cursorMatches = cursor
        ? this.matchesTargetArticle({
            board,
            author: cursor.author,
            title: cursor.title,
          })
        : (!hasKnownAid && this.matchesTargetArticle({ board }));

      if (!cursorMatches) {
        cursorMatches = await this.jumpToTargetAidInList(tab, session, generation);
        if (!cursorMatches) return false;
      }

      await this.sendToTab(tab.id, '\r', session);
      const entered = await this.waitForScreenCondition(
        tab,
        (_l, s) => s === 'reading' || s === 'resume_prompt' || s === 'live_prompt',
        { timeoutMs: 2500, settleMs: 45, generation }
      );
      if (!entered || !this.isOpen || generation !== this.sessionGeneration) return false;

      let curEnterState = this.detectBbsState(tab.buf);
      while (curEnterState === 'resume_prompt' || curEnterState === 'live_prompt') {
        await this.sendToTab(tab.id, 'n\r', session);
        const resumed = await this.waitForScreenCondition(
          tab,
          (_l, s) => s === 'reading' || s === 'resume_prompt' || s === 'live_prompt',
          { timeoutMs: 2000, settleMs: 45, generation }
        );
        if (!resumed || !this.isOpen || generation !== this.sessionGeneration) return false;
        curEnterState = this.detectBbsState(tab.buf);
      }

      if (this.detectBbsState(tab.buf) !== 'reading') return false;
      const entryLines = this.getScreenLines(tab.buf);
      const entryParsed = ArticleParser.parseLines(entryLines);
      if (!this.matchesTargetArticle(entryParsed)) return false;

      if (!this.isReadingAtEof(entryLines)) {
        await this.sendToTab(tab.id, '$', session);
        await this.waitForReadingEof(tab, 2000, generation);
      }
      return this.detectBbsState(tab.buf) === 'reading';
    }
    return false;
  }

  async pollLatest(tab = this.tab) {
    if (!this.isOpen || !tab || !tab.isConnected || this.isSending || this.isPolling || this.isCrawlingHistory) return;
    const gen = this.sessionGeneration;
    const pollStartedAt = Date.now();
    this.isPolling = true;

    try {
      if (!this.sendToTab || !this.getConnectionSession) return;
      const session = await this.getConnectionSession(tab.id);
      if (!session || !this.isOpen || gen !== this.sessionGeneration) return;

      let state = this.detectBbsState(tab.buf);

      // Step 0: Recover if a previous ':' goto-line prompt arrived late or stayed open
      if (state === 'goto_prompt') {
        await this.sendToTab(tab.id, '\r', session);
        const cleared = await this.waitForBbsState(tab, 'reading', 1200, gen);
        if (!cleared || !this.isOpen || gen !== this.sessionGeneration || this.isSending || this.isCrawlingHistory) {
          return;
        }
        state = this.detectBbsState(tab.buf);
      }

      // Step 1: If inside reading, verify we are in our locked article before exiting with 'q'
      if (state === 'reading') {
        const preLines = this.getScreenLines(tab.buf);
        const preMeta = this.parseScreenLinesSafely(preLines);
        const preAid = this.extractAidMetadata(preLines);
        const preOk = this.matchesTargetArticle({
          ...preMeta,
          board: preMeta.board || this.getBoardFromScreen(preLines, tab.buf) || preAid.board,
          aid: preMeta.aid || preAid.aid,
        });
        if (!preOk) {
          return;
        }

        await this.sendToTab(tab.id, 'q', session);
        const inList = await this.waitForBbsState(tab, 'article_list', 1500, gen);
        if (!inList || !this.isOpen || gen !== this.sessionGeneration || this.isSending || this.isCrawlingHistory) {
          return;
        }
        state = this.detectBbsState(tab.buf);
      }

      // Only proceed to re-enter if STRICTLY confirmed on article_list
      if (state !== 'article_list') {
        return;
      }

      // Step 2: Verify board & cursor row belong to the target article before pressing '\r'!
      const listLines = this.getScreenLines(tab.buf);
      const listBoard = this.getBoardFromScreen(listLines, tab.buf);
      const cursor = this.parseArticleListCursor(listLines, tab.buf);

      let cursorOk = this.matchesTargetArticle({
        board: listBoard,
        author: cursor?.author,
        title: cursor?.title,
      });

      if (!cursorOk) {
        cursorOk = await this.jumpToTargetAidInList(tab, session, gen);
        if (!cursorOk || !this.isOpen || gen !== this.sessionGeneration || this.isSending || this.isCrawlingHistory) {
          return;
        }
      }

      // Step 3: Re-enter the verified article and STRICTLY wait for 'reading'
      await this.sendToTab(tab.id, '\r', session);
      const entered = await this.waitForScreenCondition(
        tab,
        (_l, s) => s === 'reading' || s === 'resume_prompt' || s === 'live_prompt',
        { timeoutMs: 2500, settleMs: 45, generation: gen }
      );
      if (!entered || !this.isOpen || gen !== this.sessionGeneration || this.isSending || this.isCrawlingHistory) {
        return;
      }

      let curEnterState = this.detectBbsState(tab.buf);
      while (curEnterState === 'resume_prompt' || curEnterState === 'live_prompt') {
        const answer = curEnterState === 'live_prompt' ? 'n\r' : 'y\r';
        await this.sendToTab(tab.id, answer, session);
        const resumed = await this.waitForScreenCondition(
          tab,
          (_l, s) => s === 'reading' || s === 'resume_prompt' || s === 'live_prompt',
          { timeoutMs: 2000, settleMs: 45, generation: gen }
        );
        if (!resumed || !this.isOpen || gen !== this.sessionGeneration || this.isSending || this.isCrawlingHistory) {
          return;
        }
        curEnterState = this.detectBbsState(tab.buf);
      }

      if (this.detectBbsState(tab.buf) !== 'reading') return;

      // Verify Page 1 header immediately upon entering
      const entryLines = this.getScreenLines(tab.buf);
      const entryMeta = ArticleParser.parseLines(entryLines);
      const entryAid = this.extractAidMetadata(entryLines);
      const entryOk = this.matchesTargetArticle({
        ...entryMeta,
        board: entryMeta.board || this.getBoardFromScreen(entryLines, tab.buf) || entryAid.board,
        aid: entryMeta.aid || entryAid.aid,
      });
      if (!entryOk) {
        return;
      }

      // Step 4: Jump to EOF ONLY if strictly inside reading and not already at EOF
      if (!this.isReadingAtEof(entryLines)) {
        await this.sendToTab(tab.id, '$', session);
        const atEof = await this.waitForReadingEof(tab, 2500, gen);
        if (!atEof || !this.isOpen || gen !== this.sessionGeneration || this.isSending || this.isCrawlingHistory) {
          return;
        }
      }

      if (this.detectBbsState(tab.buf) !== 'reading') return;

      const screenLines = this.getScreenLines(tab.buf);
      const parsed = this.parseScreenLinesSafely(screenLines);
      const eofAid = this.extractAidMetadata(screenLines);
      const candidateMeta = {
        ...parsed,
        board: parsed.board || this.getBoardFromScreen(screenLines, tab.buf) || eofAid.board,
        aid: parsed.aid || eofAid.aid || (parsed.articleId ? filenameToAid(parsed.articleId) : null),
      };

      // Step 5: Final cross-article check before scraping any pushes
      if (!this.matchesTargetArticle(candidateMeta)) {
        return;
      }
      this.lockArticleIdentity(candidateMeta);

      if (parsed.pushList && parsed.pushList.length > 0) {
        // Catch gap if massive burst arrived since previous EOF page.
        // Use KEY_PGUP ('\x1b[5~'), NEVER 'b' ('b' = previous article on PTT!).
        if (this.pushes.length > 0 && !this.seenSignatures.has(this.makeSignature(parsed.pushList[0]))) {
          const eofRange = this.extractPageLineRange(screenLines);
          const eofProg = this.extractPageProgress(screenLines);
          if (eofProg.curPage !== 1) {
            await this.sendToTab(tab.id, '\x1b[5~', session);
            const movedUp = await this.waitForScreenCondition(
              tab,
              (lines, s) => {
                if (s !== 'reading') return true;
                const nr = this.extractPageLineRange(lines);
                const np = this.extractPageProgress(lines);
                if (eofRange && nr && nr.startNum < eofRange.startNum) return true;
                return Boolean(eofProg.curPage && np.curPage && np.curPage < eofProg.curPage);
              },
              { timeoutMs: 1500, settleMs: 45, generation: gen }
            );
            if (!this.isOpen || gen !== this.sessionGeneration || this.detectBbsState(tab.buf) !== 'reading') {
              return;
            }
            const upLines = this.getScreenLines(tab.buf);
            const upParsed = this.parseScreenLinesSafely(upLines);
            const upAid = this.extractAidMetadata(upLines);
            const upOk = this.matchesTargetArticle({
              ...upParsed,
              aid: upParsed.aid || upAid.aid,
              board: upParsed.board || this.getBoardFromScreen(upLines, tab.buf) || upAid.board,
            });
            if (!upOk) {
              return;
            }
            let gapAddedCount = 0;
            if (movedUp && upParsed.pushList) {
              this.syncAutoScrollFromContainer();
              for (const p of upParsed.pushList) {
                const sig = this.makeSignature(p);
                if (!this.seenSignatures.has(sig)) {
                  this.seenSignatures.add(sig);
                  p.floor = this.pushes.length + 1;
                  this.pushes.push(p);
                  this.appendPushElement(p);
                  gapAddedCount++;
                }
              }
              if (gapAddedCount > 0) {
                this.updateStats();
                if (this.autoScroll) {
                  this.scrollToBottom();
                } else {
                  this.unreadCount += gapAddedCount;
                  this.updateUnreadPill();
                }
              }
            }
            if (this.isOpen && gen === this.sessionGeneration && this.detectBbsState(tab.buf) === 'reading' && !this.isReadingAtEof(upLines)) {
              await this.sendToTab(tab.id, '$', session);
              await this.waitForReadingEof(tab, 1500, gen);
            }
          }
        }

        if (!this.isOpen || gen !== this.sessionGeneration) return;

        this.syncAutoScrollFromContainer();
        let addedCount = 0;
        for (const p of parsed.pushList) {
          const sig = this.makeSignature(p);
          if (!this.seenSignatures.has(sig)) {
            this.seenSignatures.add(sig);
            p.floor = this.pushes.length + 1;
            this.pushes.push(p);
            this.appendPushElement(p);
            addedCount++;
          }
        }

        if (addedCount > 0) {
          this.updateStats();
          if (this.autoScroll) {
            this.scrollToBottom();
          } else {
            this.unreadCount += addedCount;
            this.updateUnreadPill();
          }
        }
      }

      // Automatically backfill remaining older history chunks in the background
      // using pmore's ':' goto-line prompt + PageUp ('\x1b[5~'), keeping live polling active.
      if (
        this.isOpen &&
        gen === this.sessionGeneration &&
        this.hasMoreHistory &&
        this.canUseGotoPrompt &&
        this.oldestCapturedLineNum > 1 &&
        !this.isSending &&
        !this.isCrawlingHistory &&
        this.detectBbsState(tab.buf) === 'reading'
      ) {
        await this.crawlBackwardBatch(tab, session, gen, 8);
      }
    } catch (err) {
      // Background poll failure should stay silent without interrupting user
      console.warn('[LiveChat] Poll error:', err);
    } finally {
      this.isPolling = false;
      if (this.isOpen && this.pollIntervalMs > 0 && !this.isCrawlingHistory) {
        const elapsed = Date.now() - pollStartedAt;
        const nextDelay = Math.max(200, this.pollIntervalMs - elapsed);
        this.scheduleNextPoll(nextDelay, tab);
      }
    }
  }

  updateUnreadPill() {
    if (!this.unreadPill) return;
    if (this.unreadCount > 0 && !this.autoScroll) {
      this.unreadPill.textContent = `↓ 有 ${this.unreadCount} 則新推文 (點擊滾動至最新)`;
      this.unreadPill.classList.remove('hidden');
    } else {
      this.unreadPill.classList.add('hidden');
    }
  }

  isScrollContainerAtBottom(threshold = 8) {
    const c = this.scrollContainer;
    if (!c) return true;
    const scrollHeight = Number(c.scrollHeight) || 0;
    const clientHeight = Number(c.clientHeight) || 0;
    const scrollTop = Number(c.scrollTop) || 0;
    if (scrollHeight <= clientHeight) return true;
    return (scrollHeight - scrollTop - clientHeight) <= threshold;
  }

  _recordBottomScrollTop() {
    if (!this.scrollContainer) return;
    const scrollHeight = Number(this.scrollContainer.scrollHeight) || 0;
    const clientHeight = Number(this.scrollContainer.clientHeight) || 0;
    this._lastBottomScrollTop = Math.max(0, scrollHeight - clientHeight);
  }

  syncAutoScrollFromContainer() {
    if (!this.scrollContainer || !this._didInitialScrollToBottom || this._programmaticScrollToBottom) {
      return;
    }
    const atBottom = this.isScrollContainerAtBottom();
    if (atBottom) {
      this.autoScroll = true;
      this._recordBottomScrollTop();
      if (this.unreadCount > 0) {
        this.unreadCount = 0;
        this.updateUnreadPill();
      }
      return;
    }
    const currentTop = Number(this.scrollContainer.scrollTop) || 0;
    if (currentTop < this._lastBottomScrollTop - 8) {
      this.autoScroll = false;
    }
  }

  scrollToBottom(smooth = false) {
    if (!this.scrollContainer) return;
    this._didInitialScrollToBottom = true;
    const scrollHeight = Number(this.scrollContainer.scrollHeight) || 0;
    this._recordBottomScrollTop();
    if (typeof this.scrollContainer.scrollTo === 'function') {
      this.scrollContainer.scrollTo({
        top: scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
    if (!smooth) {
      this.scrollContainer.scrollTop = scrollHeight;
    }
  }

  renderAllPushes(anchorBottom = true) {
    if (!this.streamEl) return;
    const container = this.scrollContainer;
    const prevScrollTop = (!this.autoScroll && container) ? (Number(container.scrollTop) || 0) : null;

    const fragment = (typeof document !== 'undefined' && document.createDocumentFragment)
      ? document.createDocumentFragment()
      : null;

    const welcomeEl = document.createElement('div');
    welcomeEl.className = 'live-chat-welcome-card';
    welcomeEl.innerHTML = `
      <div class="welcome-icon">📺</div>
      <div class="welcome-title">PTT 實況推文聊天室模式</div>
      <div class="welcome-desc">${this.escapeHtml(this.currentArticle?.title || this.targetTitle || '實況串流監聽中')}</div>
    `;
    if (fragment) fragment.appendChild(welcomeEl);
    else this.streamEl.appendChild(welcomeEl);

    let visibleIndex = 1;
    for (const p of this.pushes) {
      if (!this.matchesFilter(p)) continue;
      const el = this.createPushElement(p, visibleIndex++);
      if (el) {
        if (fragment) fragment.appendChild(el);
        else this.streamEl.appendChild(el);
      }
    }

    if (fragment) {
      this.streamEl.innerHTML = '';
      this.streamEl.appendChild(fragment);
    }

    if (anchorBottom && this.autoScroll && container) {
      this.scrollToBottom();
    } else if (!this.autoScroll && container && prevScrollTop !== null) {
      const maxTop = Math.max(0, (Number(container.scrollHeight) || 0) - (Number(container.clientHeight) || 0));
      container.scrollTop = Math.min(prevScrollTop, maxTop);
    }
  }

  appendPushElement(p, isOptimistic = false) {
    if (!this.streamEl) return;
    if (!this.matchesFilter(p)) return;

    const el = this.createPushElement(p, this.pushes.length, isOptimistic);
    if (el) {
      this.streamEl.appendChild(el);
      // Fade in animation
      el.classList.add('animate-in');
    }
  }

  matchesFilter(p) {
    if (this.filterType === 'push' && p.tag !== '推') return false;
    if (this.filterType === 'boo' && p.tag !== '噓') return false;
    if (this.filterType === 'arrow' && p.tag !== '→') return false;
    if (this.filterUser && p.user?.toLowerCase() !== this.filterUser.toLowerCase()) return false;
    return true;
  }

  createPushElement(p, index, isOptimistic = false) {
    const user = p.user || '';
    const content = p.content || '';
    const tag = p.tag || '→';

    // Blacklist check
    const isUserBlacklisted = typeof blacklistManager?.isBlacklisted === 'function' ? blacklistManager.isBlacklisted(user) : false;
    const matchedKeyword = typeof blacklistManager?.isKeywordBlacklisted === 'function' ? blacklistManager.isKeywordBlacklisted(content) : null;
    const isBlacklisted = isUserBlacklisted || Boolean(matchedKeyword);
    const mode = typeof blacklistManager?.getMode === 'function' ? blacklistManager.getMode() : 'dim';
    const reason = isUserBlacklisted ? `黑名單用戶 ${user}` : `命中關鍵字「${matchedKeyword}」`;

    const isRevealed = this.revealedBlacklistFloors.has(index);

    if (isBlacklisted && mode === 'hide' && !isRevealed && !isOptimistic) {
      return null;
    }

    const row = document.createElement('div');
    row.className = `live-chat-msg tag-${tag === '推' ? 'push' : tag === '噓' ? 'boo' : 'arrow'}`;
    if (isOptimistic || p.isMine) row.classList.add('is-mine');
    if (isBlacklisted) {
      if (mode === 'dim') row.classList.add('blacklisted-dim');
      else if (mode === 'mask' && !isRevealed) row.classList.add('blacklisted-mask');
    }

    if (isBlacklisted && mode === 'mask' && !isRevealed && !isOptimistic) {
      row.innerHTML = `
        <div class="live-msg-mask-content">
          <span class="mask-icon">🛡️</span>
          <span class="mask-text">此留言依黑名單規則隱藏 (${this.escapeHtml(reason)})</span>
          <button type="button" class="btn-reveal-msg">顯示</button>
        </div>
      `;
      row.querySelector('.btn-reveal-msg')?.addEventListener('click', () => {
        this.revealedBlacklistFloors.add(index);
        this.renderAllPushes();
      });
      return row;
    }

    // Determine OP badge
    const opUser = (this.currentArticle?.author || '').split(' ')?.[0]?.trim();
    const isOp = opUser && user.toLowerCase() === opUser.toLowerCase();

    // Determine User Tag
    const tagInfo = userTagsManager?.getTag?.(user);

    let tagHtml = '';
    if (tagInfo && tagInfo.tag) {
      const colorScheme = TAG_COLORS?.[tagInfo.color] || { text: '#60a5fa', bg: 'rgba(59, 130, 246, 0.18)', border: '#388bfd' };
      tagHtml = `<span class="live-user-tag" data-user="${this.escapeHtml(user)}" style="background:${this.escapeHtml(colorScheme.bg)}; color:${this.escapeHtml(colorScheme.text)}; border-color:${this.escapeHtml(colorScheme.border)};">🏷️ ${this.escapeHtml(tagInfo.tag)}</span>`;
    }

    const opBadgeHtml = isOp ? `<span class="live-op-badge" title="本文章原PO">原PO</span>` : '';
    const nameTitleAttr = tagInfo ? '' : ' title="點擊開啟操作選單"';

    // Autolink URLs in content
    const linkedContent = this.autolinkContent(content);

    row.innerHTML = `
      <div class="live-msg-header">
        <span class="live-tag-badge ${tag === '推' ? 'push' : tag === '噓' ? 'boo' : 'arrow'}">${this.escapeHtml(tag)}</span>
        <span class="live-user-name" data-user="${this.escapeHtml(user)}"${nameTitleAttr}>${this.escapeHtml(user)}</span>
        ${opBadgeHtml}
        ${tagHtml}
        <span class="live-msg-time">${this.escapeHtml(p.time || '')}</span>
      </div>
      <div class="live-msg-content">${linkedContent}</div>
    `;

    // Click author to show quick actions menu
    row.querySelector('.live-user-name')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showUserMenu(e, user);
    });

    return row;
  }

  showUserMenu(e, user) {
    if (!user) return;
    this.hideUserTooltip();
    // Remove existing menu if open
    document.querySelectorAll('.live-chat-user-popover').forEach((el) => el.remove());

    const menu = document.createElement('div');
    menu.className = 'live-chat-user-popover';

    const isBlacklisted = typeof blacklistManager?.isBlacklisted === 'function' ? blacklistManager.isBlacklisted(user) : false;

    menu.innerHTML = `
      <div class="user-popover-header">
        <strong>${this.escapeHtml(user)}</strong>
      </div>
      <button type="button" class="popover-action-btn" id="btn-user-filter">🔍 只看此人推文</button>
      <button type="button" class="popover-action-btn" id="btn-user-tag">🏷️ 設定鄉民標籤</button>
      <button type="button" class="popover-action-btn" id="btn-user-blacklist">${isBlacklisted ? '✅ 移出黑名單' : '🚫 加入黑名單'}</button>
      <button type="button" class="popover-action-btn" id="btn-user-copy">📋 複製 ID</button>
    `;

    // Position menu near cursor
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    document.body.appendChild(menu);

    const closeMenu = () => menu.remove();
    setTimeout(() => {
      document.addEventListener('click', closeMenu, { once: true });
    }, 10);

    menu.querySelector('#btn-user-filter')?.addEventListener('click', () => {
      this.filterUser = user;
      if (this.filterBanner && this.filterBannerText) {
        this.filterBannerText.textContent = `🎯 正在只顯示【${user}】的發言`;
        this.filterBanner.classList.remove('hidden');
      }
      this.renderAllPushes();
      closeMenu();
    });

    menu.querySelector('#btn-user-tag')?.addEventListener('click', () => {
      this.onEditUserTag?.(user);
      closeMenu();
    });

    menu.querySelector('#btn-user-blacklist')?.addEventListener('click', () => {
      if (isBlacklisted) {
        blacklistManager?.remove?.(user);
        this.onShowToast?.(`已將 ${user} 從黑名單移出`);
      } else {
        blacklistManager?.add?.(user);
        this.onShowToast?.(`已將 ${user} 加入黑名單`);
      }
      closeMenu();
    });

    menu.querySelector('#btn-user-copy')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(user).then(() => {
        this.onShowToast?.(`已複製 ID: ${user}`);
      });
      closeMenu();
    });
  }

  _splitUrlTrailingPunctuation(rawUrl) {
    let url = rawUrl;
    let trailing = '';
    while (url.length > 0) {
      const lastChar = url[url.length - 1];
      if (/[.,;:!?]/.test(lastChar)) {
        trailing = lastChar + trailing;
        url = url.slice(0, -1);
      } else if (lastChar === ')' && !url.includes('(')) {
        trailing = lastChar + trailing;
        url = url.slice(0, -1);
      } else {
        break;
      }
    }
    return { url, trailing };
  }

  autolinkContent(text) {
    if (!text) return '';
    const urlPattern = /(https?:\/\/[^\s<>"']+)/g;
    let lastIndex = 0;
    let html = '';
    let match;

    while ((match = urlPattern.exec(text)) !== null) {
      const start = match.index;
      const end = urlPattern.lastIndex;
      html += this.escapeHtml(text.slice(lastIndex, start));
      const { url, trailing } = this._splitUrlTrailingPunctuation(match[0]);
      if (!url) {
        html += this.escapeHtml(match[0]);
        lastIndex = end;
        continue;
      }

      const safeUrl = this.escapeHtml(url);
      const ytInfo = parseYoutubeUrl(url);
      if (ytInfo) {
        const safeWatch = this.escapeHtml(ytInfo.watchUrl);
        const safeId = this.escapeHtml(ytInfo.videoId);
        html += `<a href="${safeUrl}" class="live-chat-link live-chat-yt-link" target="_blank" rel="noopener noreferrer" data-yt-id="${safeId}" data-yt-start="${ytInfo.startSeconds}" data-yt-url="${safeWatch}">${safeUrl}</a>`;
        html += `<button type="button" class="live-yt-mini-trigger" data-yt-id="${safeId}" data-yt-start="${ytInfo.startSeconds}" data-yt-url="${safeWatch}" title="以 YouTube 小視窗播放" aria-label="以 YouTube 小視窗播放">▶</button>`;
      } else if (isImageUrl(url)) {
        html += `<a href="${safeUrl}" class="live-chat-link live-chat-img-link" target="_blank" rel="noopener noreferrer" data-img-url="${safeUrl}">${safeUrl}</a>`;
      } else {
        html += `<a href="${safeUrl}" class="live-chat-link" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
      }

      if (trailing) {
        html += this.escapeHtml(trailing);
      }
      lastIndex = end;
    }
    html += this.escapeHtml(text.slice(lastIndex));
    return html;
  }

  _findAncestorByClass(el, className) {
    let cur = el;
    while (cur) {
      if (cur.classList?.contains?.(className)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  _getAttr(el, dataKey, attrName) {
    if (!el) return '';
    if (el.dataset && el.dataset[dataKey] !== undefined) {
      return el.dataset[dataKey];
    }
    if (typeof el.getAttribute === 'function') {
      return el.getAttribute(attrName) || '';
    }
    return '';
  }

  _getYtInfoFromElement(el) {
    if (!el) return null;
    const rawUrl = this._getAttr(el, 'ytUrl', 'data-yt-url') || el.href || this._getAttr(el, '', 'href');
    if (rawUrl) {
      const parsed = parseYoutubeUrl(rawUrl);
      if (parsed) return parsed;
    }
    const videoId = this._getAttr(el, 'ytId', 'data-yt-id');
    const startRaw = this._getAttr(el, 'ytStart', 'data-yt-start');
    if (!videoId) return null;
    const start = Number.parseInt(startRaw, 10);
    const suffix = Number.isFinite(start) && start > 0 ? `&t=${start}s` : '';
    return parseYoutubeUrl(`https://www.youtube.com/watch?v=${videoId}${suffix}`);
  }

  _getPointerCoords(event, targetEl) {
    if (typeof event?.clientX === 'number' && typeof event?.clientY === 'number') {
      return { x: event.clientX, y: event.clientY };
    }
    const rect = targetEl?.getBoundingClientRect?.();
    if (rect) {
      return {
        x: Math.round(rect.left + (rect.width || 0) / 2),
        y: Math.round(rect.top),
      };
    }
    return { x: 240, y: 240 };
  }

  _isHoverPreviewEnabled() {
    return this.settingsManager?.settings?.imagePreviewEnabled !== false;
  }

  ensureYoutubeUiDom() {
    if (typeof document === 'undefined' || !this.modalEl) return;

    if (!this.ytPreviewEl) {
      const hovercard = document.createElement('div');
      hovercard.id = 'live-yt-hovercard';
      hovercard.className = 'live-yt-hovercard';
      hovercard.classList?.add('hidden');
      hovercard.setAttribute?.('role', 'tooltip');

      const thumbBtn = document.createElement('button');
      thumbBtn.type = 'button';
      thumbBtn.className = 'live-yt-hovercard-thumb-btn';
      thumbBtn.title = '點擊於小視窗播放';

      const thumbImg = document.createElement('img');
      thumbImg.className = 'live-yt-hovercard-thumb';
      thumbImg.alt = 'YouTube 影片縮圖';
      thumbImg.referrerPolicy = 'no-referrer';
      thumbImg.addEventListener('error', () => {
        const info = this.activeHoverYtInfo;
        if (!info || this._ytThumbFallbackUsed) return;
        this._ytThumbFallbackUsed = true;
        thumbImg.src = info.fallbackThumbnailUrl;
      });

      const playBadge = document.createElement('span');
      playBadge.className = 'live-yt-hovercard-play-badge';
      playBadge.textContent = '▶ 點擊於小視窗播放';

      thumbBtn.appendChild(thumbImg);
      thumbBtn.appendChild(playBadge);

      const metaRow = document.createElement('div');
      metaRow.className = 'live-yt-hovercard-meta';

      const labelEl = document.createElement('span');
      labelEl.className = 'live-yt-hovercard-label';
      labelEl.textContent = 'YouTube 縮圖預覽';

      const extLink = document.createElement('a');
      extLink.className = 'live-yt-hovercard-ext';
      extLink.target = '_blank';
      extLink.rel = 'noopener noreferrer';
      extLink.textContent = '↗ YouTube 開啟';

      metaRow.appendChild(labelEl);
      metaRow.appendChild(extLink);
      hovercard.appendChild(thumbBtn);
      hovercard.appendChild(metaRow);

      this.modalEl.appendChild(hovercard);
      this.ytPreviewEl = hovercard;
      this.ytPreviewThumbBtn = thumbBtn;
      this.ytPreviewThumbEl = thumbImg;
      this.ytPreviewExtLink = extLink;

      hovercard.addEventListener('mouseenter', () => this._cancelYtHideTimer());
      hovercard.addEventListener('mouseover', () => this._cancelYtHideTimer());
      hovercard.addEventListener('focusin', () => this._cancelYtHideTimer());
      hovercard.addEventListener('mouseleave', () => this.scheduleHideYoutubePreview());
      hovercard.addEventListener('focusout', (e) => {
        if (!hovercard.contains?.(e?.relatedTarget)) {
          this.scheduleHideYoutubePreview();
        }
      });

      thumbBtn.addEventListener('click', (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        if (this.activeHoverYtInfo) {
          this.openYoutubeMiniPlayer(this.activeHoverYtInfo);
        }
      });
    }

    if (!this.ytMiniPlayerEl) {
      const mini = document.createElement('div');
      mini.id = 'live-yt-miniplayer';
      mini.className = 'live-yt-miniplayer';
      mini.classList?.add('hidden');
      mini.setAttribute?.('role', 'dialog');
      mini.setAttribute?.('aria-label', 'YouTube 小視窗播放器');

      const header = document.createElement('div');
      header.className = 'live-yt-miniplayer-header';

      const title = document.createElement('span');
      title.className = 'live-yt-miniplayer-title';
      title.textContent = '▶ YouTube 小視窗';

      const actions = document.createElement('div');
      actions.className = 'live-yt-miniplayer-actions';

      const sizeBtn = document.createElement('button');
      sizeBtn.type = 'button';
      sizeBtn.className = 'live-yt-miniplayer-btn';
      sizeBtn.title = '切換標準 / 放大尺寸';
      sizeBtn.textContent = '放大';
      sizeBtn.addEventListener('click', (e) => {
        e?.stopPropagation?.();
        this.isMiniPlayerWide = !this.isMiniPlayerWide;
        mini.classList.toggle('wide', this.isMiniPlayerWide);
        sizeBtn.textContent = this.isMiniPlayerWide ? '標準' : '放大';
        this.positionYoutubeMiniPlayer();
      });

      const extLink = document.createElement('a');
      extLink.className = 'live-yt-miniplayer-ext';
      extLink.target = '_blank';
      extLink.rel = 'noopener noreferrer';
      extLink.title = '在 YouTube 開啟';
      extLink.textContent = '↗';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'live-yt-miniplayer-close';
      closeBtn.title = '關閉小視窗 (ESC)';
      closeBtn.setAttribute?.('aria-label', '關閉 YouTube 小視窗');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', (e) => {
        e?.stopPropagation?.();
        this.closeYoutubeMiniPlayer();
      });

      actions.appendChild(sizeBtn);
      actions.appendChild(extLink);
      actions.appendChild(closeBtn);
      header.appendChild(title);
      header.appendChild(actions);

      const stage = document.createElement('div');
      stage.className = 'live-yt-miniplayer-stage';

      mini.appendChild(header);
      mini.appendChild(stage);
      this.modalEl.appendChild(mini);

      this.ytMiniPlayerEl = mini;
      this.ytMiniPlayerHeader = header;
      this.ytMiniPlayerStage = stage;
      this.ytMiniPlayerSizeBtn = sizeBtn;
      this.ytMiniPlayerExtLink = extLink;

      this._bindMiniPlayerDrag(header, actions, mini, stage);
    }
  }

  _bindMiniPlayerDrag(headerEl, actionsEl, miniEl, stageEl) {
    if (typeof document === 'undefined' || !headerEl || !miniEl) return;
    let dragState = null;

    headerEl.addEventListener('pointerdown', (e) => {
      if (e?.button !== undefined && e.button !== 0) return;
      if (actionsEl?.contains?.(e?.target)) return;
      const rect = miniEl.getBoundingClientRect?.();
      if (!rect) return;
      e?.preventDefault?.();
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop: rect.top,
      };
      if (stageEl?.style) stageEl.style.pointerEvents = 'none';

      const onMove = (moveEvt) => {
        if (!dragState) return;
        const dx = moveEvt.clientX - dragState.startX;
        const dy = moveEvt.clientY - dragState.startY;
        this.miniPlayerManualPos = this._clampMiniPlayerCoords(
          dragState.origLeft + dx,
          dragState.origTop + dy
        );
        this.positionYoutubeMiniPlayer();
      };

      const onUp = () => {
        dragState = null;
        if (stageEl?.style) stageEl.style.pointerEvents = '';
        document.removeEventListener?.('pointermove', onMove);
        document.removeEventListener?.('pointerup', onUp);
      };

      document.addEventListener?.('pointermove', onMove);
      document.addEventListener?.('pointerup', onUp);
    });
  }

  bindMediaPreviewEvents() {
    if (!this.streamEl) return;

    this.streamEl.addEventListener('mouseover', (e) => {
      if (!this.isOpen) return;

      const userTarget =
        this._findAncestorByClass(e?.target, 'live-user-name') ||
        this._findAncestorByClass(e?.target, 'live-user-tag');
      if (userTarget) {
        const hoverUser = this._getAttr(userTarget, 'user', 'data-user');
        if (hoverUser && userTagsManager?.hasTag?.(hoverUser)) {
          this.currentHoverUserTarget = userTarget;
          const { x, y } = this._getPointerCoords(e, userTarget);
          this.onShowUserTooltip?.(hoverUser, x, y);
        } else if (this.currentHoverUserTarget) {
          this.hideUserTooltip();
        }
        return;
      }
      if (this.currentHoverUserTarget) {
        this.hideUserTooltip();
      }

      if (!this._isHoverPreviewEnabled()) return;

      const ytLink = this._findAncestorByClass(e?.target, 'live-chat-yt-link');
      if (ytLink) {
        if (this.currentHoverImgLink) {
          this.currentHoverImgLink = null;
          this.imagePreview?.hideImmediate?.();
        }
        if (this.currentHoverYtLink !== ytLink) {
          this.currentHoverYtLink = ytLink;
          const ytInfo = this._getYtInfoFromElement(ytLink);
          if (ytInfo) {
            const { x, y } = this._getPointerCoords(e, ytLink);
            this.scheduleYoutubePreview(ytInfo, x, y, ytLink);
          }
        }
        return;
      }

      const imgLink = this._findAncestorByClass(e?.target, 'live-chat-img-link');
      if (imgLink) {
        this.hideYoutubePreviewImmediate();
        this.currentHoverYtLink = null;
        if (this.currentHoverImgLink !== imgLink) {
          this.currentHoverImgLink = imgLink;
          const imgUrl = this._getAttr(imgLink, 'imgUrl', 'data-img-url') || imgLink.href;
          if (imgUrl) {
            const { x, y } = this._getPointerCoords(e, imgLink);
            this.imagePreview?.show?.(imgUrl, x, y);
          }
        }
      }
    });

    this.streamEl.addEventListener('mousemove', (e) => {
      if (!this.isOpen) return;
      if (this.currentHoverUserTarget && typeof e?.clientX === 'number' && typeof e?.clientY === 'number') {
        const hoverUser = this._getAttr(this.currentHoverUserTarget, 'user', 'data-user');
        if (hoverUser && userTagsManager?.hasTag?.(hoverUser)) {
          this.onShowUserTooltip?.(hoverUser, e.clientX, e.clientY);
        } else {
          this.hideUserTooltip();
        }
      }
      if (!this.currentHoverImgLink) return;
      if (typeof e?.clientX === 'number' && typeof e?.clientY === 'number') {
        this.imagePreview?.updatePosition?.(e.clientX, e.clientY);
      }
    });

    this.streamEl.addEventListener('mouseout', (e) => {
      const userTarget =
        this._findAncestorByClass(e?.target, 'live-user-name') ||
        this._findAncestorByClass(e?.target, 'live-user-tag');
      if (userTarget && this.currentHoverUserTarget === userTarget) {
        if (!userTarget.contains?.(e?.relatedTarget)) {
          this.hideUserTooltip();
        }
        return;
      }

      const ytLink = this._findAncestorByClass(e?.target, 'live-chat-yt-link');
      if (ytLink && this.currentHoverYtLink === ytLink) {
        if (!ytLink.contains?.(e?.relatedTarget) && !this.ytPreviewEl?.contains?.(e?.relatedTarget)) {
          this.currentHoverYtLink = null;
          this.scheduleHideYoutubePreview();
        }
        return;
      }

      const imgLink = this._findAncestorByClass(e?.target, 'live-chat-img-link');
      if (imgLink && this.currentHoverImgLink === imgLink) {
        if (!imgLink.contains?.(e?.relatedTarget)) {
          this.currentHoverImgLink = null;
          this.imagePreview?.hide?.();
        }
      }
    });

    this.streamEl.addEventListener('focusin', (e) => {
      if (!this.isOpen || !this._isHoverPreviewEnabled()) return;

      const ytLink = this._findAncestorByClass(e?.target, 'live-chat-yt-link');
      if (ytLink) {
        this.currentHoverImgLink = null;
        this.imagePreview?.hideImmediate?.();
        this.currentHoverYtLink = ytLink;
        const ytInfo = this._getYtInfoFromElement(ytLink);
        if (ytInfo) {
          const { x, y } = this._getPointerCoords(e, ytLink);
          this._cancelYtHideTimer();
          this.showYoutubeHovercard(ytInfo, x, y, ytLink);
        }
        return;
      }

      const imgLink = this._findAncestorByClass(e?.target, 'live-chat-img-link');
      if (imgLink) {
        this.hideYoutubePreviewImmediate();
        this.currentHoverYtLink = null;
        this.currentHoverImgLink = imgLink;
        const imgUrl = this._getAttr(imgLink, 'imgUrl', 'data-img-url') || imgLink.href;
        if (imgUrl) {
          const { x, y } = this._getPointerCoords(e, imgLink);
          this.imagePreview?.show?.(imgUrl, x, y);
        }
      }
    });

    this.streamEl.addEventListener('focusout', (e) => {
      const ytLink = this._findAncestorByClass(e?.target, 'live-chat-yt-link');
      if (ytLink && this.currentHoverYtLink === ytLink) {
        if (!this.ytPreviewEl?.contains?.(e?.relatedTarget)) {
          this.currentHoverYtLink = null;
          this.scheduleHideYoutubePreview();
        }
        return;
      }

      const imgLink = this._findAncestorByClass(e?.target, 'live-chat-img-link');
      if (imgLink && this.currentHoverImgLink === imgLink) {
        this.currentHoverImgLink = null;
        this.imagePreview?.hide?.();
      }
    });

    this.streamEl.addEventListener('click', (e) => {
      if (!this.isOpen) return;
      const triggerBtn = this._findAncestorByClass(e?.target, 'live-yt-mini-trigger');
      if (triggerBtn) {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const ytInfo = this._getYtInfoFromElement(triggerBtn);
        if (ytInfo) {
          this.openYoutubeMiniPlayer(ytInfo);
        }
      }
    });

    if (typeof document !== 'undefined' && !this._boundGlobalKeyDown) {
      this._boundGlobalKeyDown = (e) => {
        if (!this.isOpen || e?.key !== 'Escape') return;
        if (this.ytPreviewVisible || this.currentHoverImgLink) {
          this.hideMediaHoverPreviews();
          e?.stopPropagation?.();
          return;
        }
        if (this.activeMiniPlayerYtInfo) {
          this.closeYoutubeMiniPlayer();
          e?.stopPropagation?.();
        }
      };
      document.addEventListener?.('keydown', this._boundGlobalKeyDown, true);
    }
  }

  _cancelYtShowTimer() {
    if (this.ytShowTimer) {
      clearTimeout(this.ytShowTimer);
      this.ytShowTimer = null;
    }
  }

  _cancelYtHideTimer() {
    if (this.ytHideTimer) {
      clearTimeout(this.ytHideTimer);
      this.ytHideTimer = null;
    }
  }

  scheduleYoutubePreview(ytInfo, cursorX, cursorY, triggerEl = null) {
    this._cancelYtHideTimer();
    this._cancelYtShowTimer();

    if (this.ytPreviewVisible || this.ytPreviewDelayMs <= 0) {
      this.showYoutubeHovercard(ytInfo, cursorX, cursorY, triggerEl);
      return;
    }

    this.ytShowTimer = setTimeout(() => {
      this.ytShowTimer = null;
      if (!this.isOpen) return;
      this.showYoutubeHovercard(ytInfo, cursorX, cursorY, triggerEl);
    }, this.ytPreviewDelayMs);
  }

  scheduleHideYoutubePreview() {
    this._cancelYtShowTimer();
    this._cancelYtHideTimer();
    if (this.ytHideDelayMs <= 0) {
      this.hideYoutubePreviewImmediate();
      return;
    }
    this.ytHideTimer = setTimeout(() => {
      this.ytHideTimer = null;
      this.hideYoutubePreviewImmediate();
    }, this.ytHideDelayMs);
  }

  showYoutubeHovercard(ytInfo, cursorX, cursorY, triggerEl = null) {
    if (!ytInfo || !this.isOpen) return;
    this.ensureYoutubeUiDom();
    if (!this.ytPreviewEl || !this.ytPreviewThumbEl) return;

    if (this.activeHoverYtTriggerEl && this.activeHoverYtTriggerEl !== triggerEl) {
      this.activeHoverYtTriggerEl.removeAttribute?.('aria-describedby');
    }

    this.activeHoverYtInfo = ytInfo;
    this.activeHoverYtTriggerEl = triggerEl;
    this._ytThumbFallbackUsed = false;
    this.ytPreviewThumbEl.src = ytInfo.thumbnailUrl;
    if (this.ytPreviewExtLink) {
      this.ytPreviewExtLink.href = ytInfo.watchUrl;
    }
    if (triggerEl?.setAttribute) {
      triggerEl.setAttribute('aria-describedby', 'live-yt-hovercard');
    }

    this.ytPreviewEl.classList.remove('hidden');
    this.ytPreviewVisible = true;
    this.positionYoutubeHovercard(cursorX, cursorY);
  }

  positionYoutubeHovercard(cursorX, cursorY) {
    if (!this.ytPreviewEl?.style) return;
    const vw = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024;
    const vh = typeof window !== 'undefined' ? (window.innerHeight || 768) : 768;
    const cardW = 280;
    const cardH = 210;
    const pad = 16;

    let left = (Number.isFinite(cursorX) ? cursorX : 240) + pad;
    let top = (Number.isFinite(cursorY) ? cursorY : 240) + pad;

    if (left + cardW > vw - pad) {
      left = Math.max(pad, (Number.isFinite(cursorX) ? cursorX : vw) - cardW - pad);
    }
    if (top + cardH > vh - pad) {
      top = Math.max(pad, vh - cardH - pad);
    }
    left = Math.max(pad, left);
    top = Math.max(pad, top);

    this.ytPreviewEl.style.left = `${left}px`;
    this.ytPreviewEl.style.top = `${top}px`;
  }

  hideYoutubePreviewImmediate() {
    this._cancelYtShowTimer();
    this._cancelYtHideTimer();
    this.ytPreviewVisible = false;
    this.activeHoverYtInfo = null;
    if (this.activeHoverYtTriggerEl?.removeAttribute) {
      this.activeHoverYtTriggerEl.removeAttribute('aria-describedby');
    }
    this.activeHoverYtTriggerEl = null;
    this.ytPreviewEl?.classList.add('hidden');
  }

  hideUserTooltip() {
    this.currentHoverUserTarget = null;
    this.onHideUserTooltip?.();
  }

  hideMediaHoverPreviews() {
    this.currentHoverImgLink = null;
    this.currentHoverYtLink = null;
    this.hideUserTooltip();
    this.imagePreview?.hideImmediate?.();
    this.hideYoutubePreviewImmediate();
  }

  _clampMiniPlayerCoords(left, top) {
    const vw = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024;
    const vh = typeof window !== 'undefined' ? (window.innerHeight || 768) : 768;
    const width = Math.min(this.isMiniPlayerWide ? 520 : 360, vw - 24);
    const height = Math.round(width * 9 / 16) + 38;
    const pad = 12;
    return {
      left: Math.max(pad, Math.min(vw - width - pad, left)),
      top: Math.max(pad, Math.min(vh - height - pad, top)),
    };
  }

  positionYoutubeMiniPlayer() {
    if (!this.ytMiniPlayerEl?.style) return;
    const vw = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024;
    const vh = typeof window !== 'undefined' ? (window.innerHeight || 768) : 768;
    const width = Math.min(this.isMiniPlayerWide ? 520 : 360, vw - 24);
    const height = Math.round(width * 9 / 16) + 38;

    const target = this.miniPlayerManualPos
      ? this._clampMiniPlayerCoords(this.miniPlayerManualPos.left, this.miniPlayerManualPos.top)
      : this._clampMiniPlayerCoords(vw - width - 20, vh - height - 92);

    this.ytMiniPlayerEl.style.left = `${target.left}px`;
    this.ytMiniPlayerEl.style.top = `${target.top}px`;
  }

  openYoutubeMiniPlayer(ytInfo) {
    if (!ytInfo || typeof document === 'undefined') return;
    this.ensureYoutubeUiDom();
    if (!this.ytMiniPlayerEl || !this.ytMiniPlayerStage) return;

    this.hideMediaHoverPreviews();
    this._clearMiniPlayerIframe();

    const iframe = document.createElement('iframe');
    iframe.className = 'live-yt-miniplayer-iframe';
    iframe.src = ytInfo.embedUrl;
    iframe.title = 'YouTube 小視窗播放器';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.setAttribute?.('allowfullscreen', '');

    this.ytMiniPlayerStage.appendChild(iframe);
    if (this.ytMiniPlayerExtLink) {
      this.ytMiniPlayerExtLink.href = ytInfo.watchUrl;
    }

    this.activeMiniPlayerYtInfo = ytInfo;
    this.ytMiniPlayerEl.classList.remove('hidden');
    this.positionYoutubeMiniPlayer();
  }

  _clearMiniPlayerIframe() {
    if (!this.ytMiniPlayerStage) return;
    const existing = this.ytMiniPlayerStage.querySelector?.('iframe');
    if (existing) {
      existing.src = 'about:blank';
    }
    if (typeof this.ytMiniPlayerStage.replaceChildren === 'function') {
      this.ytMiniPlayerStage.replaceChildren();
    } else {
      this.ytMiniPlayerStage.innerHTML = '';
    }
  }

  closeYoutubeMiniPlayer() {
    this._clearMiniPlayerIframe();
    this.activeMiniPlayerYtInfo = null;
    this.ytMiniPlayerEl?.classList.add('hidden');
  }

  clearMediaPreviewsAndMiniPlayer() {
    this.hideMediaHoverPreviews();
    this.closeYoutubeMiniPlayer();
  }

  async handleSendPush() {
    const input = this.inputEl;
    const text = input?.value?.trim();
    if (!text || this.isSending) return;

    if (!this.tab || !this.tab.isConnected) {
      this.onShowToast?.('尚未連線至 BBS，無法送出推文');
      return;
    }

    this.isSending = true;
    this.updateInputUiState(true);
    this.stopPolling();

    // Wait for any in-flight background poll or history crawl to settle
    let settleWait = 0;
    while ((this.isPolling || this.isCrawlingHistory) && settleWait < 30) {
      await new Promise((r) => setTimeout(r, 50));
      settleWait++;
    }

    const tagText = this.activeType === '1' ? '推' : (this.activeType === '2' ? '噓' : '→');
    const myId = this.getUserId(this.tab) || '我';

    let optimisticPush = null;

    try {
      // 0a. Check if terminal is stuck in an article reply or edit prompt
      const screenLines = this.getScreenLines(this.tab.buf);
      const bottom = (screenLines[screenLines.length - 1] || '') + '\n' + (screenLines[screenLines.length - 2] || '');
      if (/回應至\s*[(（]|請問要引用原文嗎|引用原文\s*[(（]|文章標題\s*[:：]|發表文章種類/.test(bottom)) {
        const session = await this.getConnectionSession(this.tab.id);
        if (session && this.sendToTab) {
          await this.sendToTab(this.tab.id, 'q\x1b', session);
        }
        this.onShowToast?.('偵測到終端機處於文章回應或發文畫面，已自動為您取消以防誤發');
        return;
      }

      // 0b. BBS State Preflight check: Ensure terminal is inside the article before pushing
      const session = await this.getConnectionSession?.(this.tab.id);
      const inArticle = await this.ensureInTargetArticle(this.tab, session);
      if (!inArticle) {
        this.onShowToast?.('目前終端機尚未處於文章閱讀狀態，請先進入文章再推文');
        return;
      }

      // 1. Split text into segments for automatic continuous push
      const isOp = this.checkIsOp();
      const segments = this.pushHelper?.splitText ? this.pushHelper.splitText(text) : [text];
      let confirmedCount = 0;

      for (let i = 0; i < segments.length; i++) {
        if (!this.isOpen || !this.isSending) break;
        const seg = segments[i];
        const isFirst = (i === 0);
        const segType = isOp ? '3' : (isFirst ? this.activeType : '3');

        if (this.sendBtn) {
          this.sendBtn.textContent = segments.length > 1 ? `發送中 (${i + 1}/${segments.length})...` : '發送中...';
        }

        let outcome = { status: 'confirmed' };
        if (this.pushHelper) {
          outcome = await this.pushHelper.sendSegmentSequence(seg, segType, isFirst);
        }

        if (outcome.status === 'cooldown') {
          const sec = outcome.seconds || 5;
          let remaining = sec + 0.5;
          while (remaining > 0 && this.isOpen && this.isSending) {
            if (this.sendBtn) {
              this.sendBtn.textContent = `冷卻中 ${remaining.toFixed(1)}s (${i + 1}/${segments.length})`;
            }
            await new Promise((r) => setTimeout(r, 200));
            remaining -= 0.2;
          }
          i--; // Retry this segment!
          continue;
        }

        if (outcome.status === 'aborted') {
          this.onShowToast?.(outcome.error || '推文已中止');
          break;
        }

        confirmedCount++;

        // Small safe delay between segments (300ms) if no cooldown
        if (i < segments.length - 1 && this.isOpen && this.isSending) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      if (confirmedCount > 0) {
        if (input) input.value = '';
        this.updateCharCount();
        this.onShowToast?.(segments.length > 1 ? `已順利完成連續推文（共 ${confirmedCount} 段）！` : '推文已順利送出！');
      }
    } catch (err) {
      this.onShowToast?.(`推文發送失敗：${err.message || err}`);
    } finally {
      this.isSending = false;
      this.updateInputUiState(false);
      this.inputEl?.focus();
      this.startPolling(this.tab);
      // Wait 0.5s for BBS disk/screen to settle, then force an immediate background refresh!
      await new Promise((r) => setTimeout(r, 500));
      await this.pollLatest();
    }
  }

  updateInputUiState(sending) {
    if (this.inputEl) this.inputEl.disabled = sending;
    if (this.sendBtn) {
      this.sendBtn.disabled = sending;
      this.sendBtn.textContent = sending ? '發送中...' : '送出 ⏎';
    }
  }

  waitForBufferUpdate(tab, timeoutMs = 300) {
    return new Promise((resolve) => {
      let resolved = false;
      const orig = tab?.buf?.onUpdate;
      let settleTimer = null;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (tab?.buf) tab.buf.onUpdate = orig;
          resolve();
        }
      }, timeoutMs);
      timer?.unref?.();

      if (tab?.buf) {
        tab.buf.onUpdate = () => {
          if (orig) orig();
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            if (tab?.buf) tab.buf.onUpdate = orig;
            settleTimer = setTimeout(resolve, 30);
            settleTimer?.unref?.();
          }
        };
      }
    });
  }

  getScreenLines(buf) {
    const lines = [];
    if (!buf || !buf.lines) return lines;
    for (let r = 0; r < buf.rows; r++) {
      let str = '';
      for (let c = 0; c < buf.cols; c++) {
        const cell = buf.lines[r]?.[c];
        if (!cell || cell.isTrailByte) continue;
        str += cell.ch || ' ';
      }
      lines.push(str.trimEnd());
    }
    return lines;
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
