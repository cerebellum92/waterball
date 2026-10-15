import { TermBuf } from './term_buf.js';
import { AnsiParser } from './ansi_parser.js';
import { TermView } from './term_view.js';
import { settingsManager } from './settings.js';

let tabCounter = 1;

export class Tab {
  constructor(options = {}) {
    this.id = options.id || `tab-${Date.now()}-${tabCounter++}`;
    this.title = options.title || `連線 ${tabCounter - 1}`;
    this.address = options.address || 'bbs@ptt.cc:22';
    this.encoding = options.encoding || 'big5';
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.unread = false;

    // Independent Terminal Buffer & Parser
    this.buf = new TermBuf(80, 24);
    this.parser = new AnsiParser(this.buf);
    this.view = null; // Instantiated by TabManager
  }

  get isConnected() {
    return this.status === 'connected';
  }
}

export class TabManager {
  constructor(tabBarEl, terminalContainerEl, imeInputEl) {
    this.tabBarEl = tabBarEl;
    this.terminalContainerEl = terminalContainerEl;
    this.imeInputEl = imeInputEl;
    this.tabs = [];
    this.activeTabId = null;

    this.onActiveTabChange = null;
    this.onTabCloseRequest = null;
    this.onUrlClick = null;
    this.onUrlHover = null;
    this.onUrlLeave = null;
    this.onWheel = null;
    this.onSelectionChange = null;
    this.onArticleClick = null;
    this.onBoardClick = null;

    // Mobile Chrome-style Tab Switcher elements
    this.mobileTabBtn = document.getElementById('mobile-tab-btn');
    this.mobileTabCount = document.getElementById('mobile-tab-count');
    this.mobileTabUnreadDot = document.getElementById('mobile-tab-unread-dot');
    this.tabSwitcherModal = document.getElementById('tab-switcher-modal');
    this.tabSwitcherCount = document.getElementById('tab-switcher-count');
    this.tabSwitcherCards = document.getElementById('tab-switcher-cards');
    this.tabSwitcherNewBtn = document.getElementById('tab-switcher-new-btn');
    this.tabSwitcherCloseBtn = document.getElementById('tab-switcher-close-btn');
  }

  init() {
    // Hook up Mobile Tab Switcher events
    this.mobileTabBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTabSwitcher();
    });

    this.tabSwitcherCloseBtn?.addEventListener('click', () => {
      this.closeTabSwitcher();
    });

    this.tabSwitcherModal?.addEventListener('click', (e) => {
      if (e.target === this.tabSwitcherModal) {
        this.closeTabSwitcher();
      }
    });

    this.tabSwitcherNewBtn?.addEventListener('click', () => {
      const newTab = this.createTab({
        title: '批踢踢實業坊',
        address: 'bbs@ptt.cc:22',
        encoding: 'big5',
      });
      this.switchTab(newTab.id);
      this.closeTabSwitcher();
    });

    // Create initial first tab
    const firstTab = this.createTab({
      title: '批踢踢實業坊',
      address: 'bbs@ptt.cc:22',
      encoding: 'big5',
    });
    this.switchTab(firstTab.id);
  }

  createTab(options = {}) {
    const tab = new Tab(options);
    tab.view = new TermView(this.terminalContainerEl, tab.buf, this.imeInputEl);
    tab.view.setFontStyle(settingsManager.settings.fontFamily || 'auto', settingsManager.settings.customFont || '');
    tab.view.setCursorStyle(settingsManager.settings.cursorStyle || 'underline');
    tab.view.setMouseBrowsingEnabled(settingsManager.settings.mouseBrowsingEnabled !== false);

    // Wire view callbacks to tab manager handlers
    tab.view.onUrlClick = (url) => this.onUrlClick?.(url, tab);
    tab.view.onUrlHover = (url, cx, cy) => this.onUrlHover?.(url, cx, cy, tab);
    tab.view.onUrlLeave = () => this.onUrlLeave?.(tab);
    tab.view.onWordHover = (word, cx, cy) => this.onWordHover?.(word, cx, cy, tab);
    tab.view.onWordLeave = () => this.onWordLeave?.(tab);
    tab.view.onWheel = (direction) => this.onWheel?.(direction, tab);
    tab.view.onSelectionChange = (sel) => this.onSelectionChange?.(sel, tab);
    tab.view.onArticleClick = (row) => this.onArticleClick?.(row, tab);
    tab.view.onBoardClick = (row) => this.onBoardClick?.(row, tab);
    tab.view.onShortcutClick = (shortcut) => this.onShortcutClick?.(shortcut, tab);
    tab.view.onContextMenu = (info) => this.onContextMenu?.(info, tab);

    // Initial welcome banner for new tab
    tab.parser.feed('\x1b[1;36m╔═════════════════════════════════════╗\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m  \x1b[1;33mWaterball (水球)\x1b[0m — 跨平台 BBS 連線終端 (Mac / Windows / Linux)         \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m                                                                          \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m  \x1b[1;32m★ 快捷鍵指南：\x1b[0m                                                         \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘ + K ]\x1b[0m  看板快速跳轉 (中英文板名即時直達)                         \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘ + D ]\x1b[0m  圖文好讀版 (無損長文採集、大圖展開)                       \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘ + P ]\x1b[0m  ANSI 調色盤 (16色雙色發文、符號顏文字)                    \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘+Shift+X ]\x1b[0m 智慧長推文 (自動分段排版、防冷卻定時發送)              \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘+Shift+S ]\x1b[0m 畫面截圖匯出 (2x Retina PNG 與 ANSI 代碼)              \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m                                                                          \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m  \x1b[1;32m★ 連線方式：\x1b[0m                                                           \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m    請點選上方「⭐ 常用書籤」或直接輸入位址並按 Enter 連線                \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m║\x1b[0m    例如: \x1b[1;33mbbs@ptt.cc:22\x1b[0m (SSH) 或 \x1b[1;33mnckugibbs.duckdns.org\x1b[0m (Telnet)           \x1b[1;36m║\r\n\x1b[0m');
    tab.parser.feed('\x1b[1;36m╚═════════════════════════════════════╝\r\n\x1b[0m');

    this.tabs.push(tab);
    this.renderTabBar();
    return tab;
  }

  getActiveTab() {
    return this.tabs.find((t) => t.id === this.activeTabId) || this.tabs[0] || null;
  }

  getTabById(id) {
    return this.tabs.find((t) => t.id === id);
  }

  switchTab(tabId) {
    const targetTab = this.getTabById(tabId);
    if (!targetTab) return;

    this.activeTabId = tabId;
    targetTab.unread = false;

    // Attach active tab's view wrapper to container & re-hook imeInput
    if (targetTab.view) {
      this.terminalContainerEl.replaceChildren(targetTab.view.wrapper);
      targetTab.view.setImeInput(this.imeInputEl);
      targetTab.view.resize();
      targetTab.view.redraw();
    }

    this.renderTabBar();
    this.onActiveTabChange?.(targetTab);
  }

  switchToNextTab() {
    if (this.tabs.length <= 1) return;
    const currIdx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const nextIdx = (currIdx + 1) % this.tabs.length;
    this.switchTab(this.tabs[nextIdx].id);
  }

  switchToPrevTab() {
    if (this.tabs.length <= 1) return;
    const currIdx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const prevIdx = (currIdx - 1 + this.tabs.length) % this.tabs.length;
    this.switchTab(this.tabs[prevIdx].id);
  }

  switchToTabIndex(index) {
    if (index >= 0 && index < this.tabs.length) {
      this.switchTab(this.tabs[index].id);
    }
  }

  closeTab(tabId) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    const closingTab = this.tabs[idx];
    this.onTabCloseRequest?.(closingTab);

    // Destroy view timers
    if (closingTab.view) {
      closingTab.view.destroy();
    }

    this.tabs.splice(idx, 1);

    if (this.tabs.length === 0) {
      // If all tabs closed, create a fresh new tab
      const freshTab = this.createTab({
        title: '批踢踢實業坊',
        address: 'bbs@ptt.cc:22',
        encoding: 'big5',
      });
      this.switchTab(freshTab.id);
    } else {
      // Switch to adjacent tab if active tab was closed
      if (this.activeTabId === tabId) {
        const nextIdx = Math.max(0, idx - 1);
        this.switchTab(this.tabs[nextIdx].id);
      } else {
        this.renderTabBar();
      }
    }
  }

  updateTabStatus(tabId, status) {
    const tab = this.getTabById(tabId);
    if (tab) {
      tab.status = status;
      if (status === 'connected') {
        const cleanHost = tab.address.split(':')[0].replace(/.*@/, '');
        if (cleanHost.includes('ptt.cc')) tab.title = '批踢踢實業坊';
        else if (cleanHost.includes('ptt2.cc')) tab.title = '批踢踢兔';
        else if (cleanHost.includes('duckdns') || cleanHost.includes('ncku')) tab.title = '成大物治';
        else if (cleanHost.includes('gamer')) tab.title = '巴哈姆特';
        else tab.title = cleanHost;
      }
      this.renderTabBar();
      if (this.activeTabId === tabId) {
        this.onActiveTabChange?.(tab);
      }
    }
  }

  feedData(tabId, data, rawBig5 = false) {
    const tab = this.getTabById(tabId);
    if (tab) {
      const decoded = tab.parser.feed(data, rawBig5);
      if (this.activeTabId !== tabId) {
        tab.unread = true;
        this.renderTabBar();
      }
      return decoded;
    }
    return '';
  }

  renderTabBar() {
    this.updateMobileTabBadge();
    if (this.isTabSwitcherOpen()) {
      this.renderTabSwitcher();
    }

    if (!this.tabBarEl) return;
    this.tabBarEl.innerHTML = '';

    const tabList = document.createElement('div');
    tabList.className = 'tab-list';

    this.tabs.forEach((tab, index) => {
      const tabEl = document.createElement('div');
      tabEl.className = `bbs-tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.dataset.tabId = tab.id;

      // Status indicator dot
      const dot = document.createElement('span');
      dot.className = `bbs-tab-dot ${tab.status}`;
      tabEl.appendChild(dot);

      // Title
      const titleSpan = document.createElement('span');
      titleSpan.className = 'bbs-tab-title';
      titleSpan.textContent = `${index + 1}. ${tab.title}`;
      if (tab.unread) {
        titleSpan.classList.add('unread');
      }
      tabEl.appendChild(titleSpan);

      // Unread notification badge
      if (tab.unread) {
        const unreadDot = document.createElement('span');
        unreadDot.className = 'bbs-tab-unread-dot';
        unreadDot.title = '有新訊息 / 水球';
        tabEl.appendChild(unreadDot);
      }

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'bbs-tab-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = '關閉此分頁 (Cmd+W)';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };
      tabEl.appendChild(closeBtn);

      tabEl.onclick = () => this.switchTab(tab.id);
      tabList.appendChild(tabEl);
    });

    // New Tab button [+] appended inside tabList directly behind the last active tab
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'bbs-tab-new';
    newTabBtn.innerHTML = '＋';
    newTabBtn.title = '開啟新連線分頁 (Cmd+T)';
    newTabBtn.onclick = () => {
      const newTab = this.createTab({
        title: `連線 ${this.tabs.length + 1}`,
        address: 'bbs@ptt.cc:22',
        encoding: 'big5',
      });
      this.switchTab(newTab.id);
    };
    tabList.appendChild(newTabBtn);

    this.tabBarEl.appendChild(tabList);
  }

  updateMobileTabBadge() {
    if (this.mobileTabCount) {
      this.mobileTabCount.textContent = this.tabs.length;
    }
    if (this.mobileTabUnreadDot) {
      const hasUnread = this.tabs.some((t) => t.id !== this.activeTabId && t.unread);
      this.mobileTabUnreadDot.classList.toggle('hidden', !hasUnread);
    }
  }

  isTabSwitcherOpen() {
    return Boolean(this.tabSwitcherModal && !this.tabSwitcherModal.classList.contains('hidden'));
  }

  openTabSwitcher() {
    if (!this.tabSwitcherModal) return;
    this.renderTabSwitcher();
    this.tabSwitcherModal.classList.remove('hidden');
  }

  closeTabSwitcher() {
    if (!this.tabSwitcherModal) return;
    this.tabSwitcherModal.classList.add('hidden');
    const activeTab = this.getActiveTab();
    if (activeTab?.view) {
      activeTab.view.focus();
    }
  }

  toggleTabSwitcher() {
    if (this.isTabSwitcherOpen()) {
      this.closeTabSwitcher();
    } else {
      this.openTabSwitcher();
    }
  }

  renderTabSwitcher() {
    if (!this.tabSwitcherCards) return;
    if (this.tabSwitcherCount) {
      this.tabSwitcherCount.textContent = this.tabs.length;
    }
    this.tabSwitcherCards.innerHTML = '';

    this.tabs.forEach((tab, index) => {
      const isActive = tab.id === this.activeTabId;
      const card = document.createElement('div');
      card.className = `tab-card ${isActive ? 'active' : ''}`;
      card.dataset.tabId = tab.id;

      let statusLabel = '未連線';
      if (tab.status === 'connected') statusLabel = '已連線';
      else if (tab.status === 'connecting') statusLabel = '連線中...';

      const titleEsc = String(tab.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const addrEsc = String(tab.address || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      card.innerHTML = `
        <div class="tab-card-header">
          <div class="tab-card-title-wrap">
            <span class="bbs-tab-dot ${tab.status}"></span>
            <span class="tab-card-title">${index + 1}. ${titleEsc}</span>
          </div>
          <button class="tab-card-close" title="關閉分頁">&times;</button>
        </div>
        <div class="tab-card-body">
          <div class="tab-card-address">${addrEsc}</div>
          <div class="tab-card-badges">
            <span class="tab-card-status-badge ${tab.status}">${statusLabel}</span>
            ${isActive ? '<span class="tab-card-active-badge">使用中</span>' : ''}
            ${tab.unread ? '<span class="tab-card-unread-badge">新訊息</span>' : ''}
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.tab-card-close')) return;
        this.switchTab(tab.id);
        this.closeTabSwitcher();
      });

      const closeBtn = card.querySelector('.tab-card-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
          this.renderTabSwitcher();
        });
      }

      this.tabSwitcherCards.appendChild(card);
    });
  }
}
