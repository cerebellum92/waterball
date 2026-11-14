import { TermBuf } from './term_buf.js';
import { AnsiParser } from './ansi_parser.js';
import { TermView } from './term_view.js';
import { settingsManager, getDefaultAddress } from './settings.js';
import { isMac } from './keymap.js';
import { resolveEnv, getShortcutTooltip } from './shortcuts_config.js';

let tabCounter = 1;

export function extractHostFromAddress(address) {
  if (!address || typeof address !== 'string') return '';
  let clean = address.trim().replace(/^[a-z0-9+.-]+:\/\//i, '');
  clean = clean.replace(/^[^@/]+@/, '');
  clean = clean.split(/[/?#]/)[0];
  if (clean.startsWith('[') && clean.includes(']')) {
    clean = clean.replace(/^\[([^\]]+)\].*$/, '$1');
  } else {
    const colonIdx = clean.lastIndexOf(':');
    if (colonIdx !== -1) {
      clean = clean.substring(0, colonIdx);
    }
  }
  return clean.toLowerCase();
}

export function resolveBookmarkName(address, bookmarks = []) {
  if (!address || !Array.isArray(bookmarks) || bookmarks.length === 0) return null;
  const raw = address.trim();
  const host = extractHostFromAddress(raw);

  const exact = bookmarks.find((b) => b.address?.trim() === raw);
  if (exact?.name) return exact.name;

  if (host) {
    const hostMatch = bookmarks.find((b) => {
      const bHost = extractHostFromAddress(b.address);
      return bHost && bHost === host;
    });
    if (hostMatch?.name) return hostMatch.name;

    if (host.includes('ptt.cc')) {
      const pttMatch = bookmarks.find((b) => {
        const bHost = extractHostFromAddress(b.address);
        return bHost && bHost.includes('ptt.cc');
      });
      if (pttMatch?.name) return pttMatch.name;
    }
  }

  return null;
}

export class Tab {
  constructor(options = {}) {
    this.id = options.id || `tab-${Date.now()}-${tabCounter++}`;
    this.title = options.title || `連線 ${tabCounter - 1}`;
    this.address = options.address || getDefaultAddress();
    this.encoding = options.encoding || 'big5';
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.unread = false;
    this.bookmarkName = options.bookmarkName || null;

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
    this.isSplit = false;
    this.splitTabId = null;
    this.focusedTabId = null;

    this.onActiveTabChange = null;
    this.onTabCloseRequest = null;
    this.onUrlClick = null;
    this.onUrlHover = null;
    this.onUrlLeave = null;
    this.onAidClick = null;
    this.onAidHover = null;
    this.onAidLeave = null;
    this.onWheel = null;
    this.onSelectionChange = null;
    this.onArticleClick = null;
    this.onBoardClick = null;
    this.onBell = null;

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

    const defaultAddress = getDefaultAddress();
    const defaultBmName = resolveBookmarkName(defaultAddress, settingsManager?.bookmarks) || '批踢踢實業坊';

    this.tabSwitcherNewBtn?.addEventListener('click', () => {
      const newTab = this.createTab({
        title: defaultBmName,
        address: defaultAddress,
        encoding: 'big5',
        bookmarkName: defaultBmName,
      });
      this.switchTab(newTab.id);
      this.closeTabSwitcher();
    });

    // Create initial first tab
    const firstTab = this.createTab({
      title: defaultBmName,
      address: defaultAddress,
      encoding: 'big5',
      bookmarkName: defaultBmName,
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
    tab.view.onAidClick = (aid) => this.onAidClick?.(aid, tab);
    tab.view.onAidHover = (aid, cx, cy) => this.onAidHover?.(aid, cx, cy, tab);
    tab.view.onAidLeave = () => this.onAidLeave?.(tab);
    tab.view.onWordHover = (word, cx, cy) => this.onWordHover?.(word, cx, cy, tab);
    tab.view.onWordLeave = () => this.onWordLeave?.(tab);
    tab.view.onWheel = (direction) => this.onWheel?.(direction, tab);
    tab.view.onSelectionChange = (sel) => this.onSelectionChange?.(sel, tab);
    tab.view.onArticleClick = (row) => this.onArticleClick?.(row, tab);
    tab.view.onBoardClick = (row) => this.onBoardClick?.(row, tab);
    tab.view.onShortcutClick = (shortcut) => this.onShortcutClick?.(shortcut, tab);
    tab.view.onContextMenu = (info) => this.onContextMenu?.(info, tab);
    tab.buf.onBell = () => this.onBell?.(tab);

    // Initial welcome banner for new tab
    tab.parser.feed('\x1b[1;36m╔═════════════════════════════════════╗\r\n\x1b[0m');
    if (isMac) {
      tab.parser.feed('\x1b[1;36m║\x1b[0m  \x1b[1;33mWaterball (水球)\x1b[0m — 跨平台 BBS 連線終端 (macOS)                         \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m                                                                          \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m  \x1b[1;32m★ 快捷鍵指南 (隨時按 \x1b[1;33mF1\x1b[1;32m 查閱完整清單)：\x1b[0m                                \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘ + K ]\x1b[0m  看板快速跳轉 (中英文板名即時直達)                         \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘ + D ]\x1b[0m  圖文好讀版 (無損長文採集、大圖展開)                       \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌥ + B ]\x1b[0m  收合／展開功能列 (極大化終端可視範圍)                     \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘ + P ]\x1b[0m  ANSI 調色盤 (16色雙色發文、符號顏文字)                    \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ ⌘+Shift+X ]\x1b[0m 智慧長推文 (自動分段排版、防冷卻定時發送)              \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ F1 ]\x1b[0m     鍵盤快捷鍵一覽表 (完整熱鍵速查手冊)                        \x1b[1;36m║\r\n\x1b[0m');
    } else {
      tab.parser.feed('\x1b[1;36m║\x1b[0m  \x1b[1;33mWaterball (水球)\x1b[0m — 跨平台 BBS 連線終端 (Windows / Linux)               \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m                                                                          \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m  \x1b[1;32m★ 快捷鍵指南 (隨時按 \x1b[1;33mF1\x1b[1;32m 查閱完整清單)：\x1b[0m                                \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ Alt + K ]\x1b[0m  看板快速跳轉 (中英文板名即時直達)                       \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ F2 ]\x1b[0m       圖文好讀版 (無損長文採集、大圖展開)                     \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ Alt + B ]\x1b[0m  收合／展開功能列 (極大化終端可視範圍)                   \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ Alt + P ]\x1b[0m  ANSI 調色盤 (16色雙色發文、符號顏文字)                  \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ Alt + X ]\x1b[0m  智慧長推文 (自動分段排版、防冷卻定時發送)                \x1b[1;36m║\r\n\x1b[0m');
      tab.parser.feed('\x1b[1;36m║\x1b[0m    \x1b[1;37m[ F1 ]\x1b[0m       鍵盤快捷鍵一覽表 (完整熱鍵速查手冊)                      \x1b[1;36m║\r\n\x1b[0m');
    }
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
    if (this.isSplit && this.focusedTabId) {
      const focused = this.getTabById(this.focusedTabId);
      if (focused) return focused;
    }
    return this.tabs.find((t) => t.id === this.activeTabId) || this.tabs[0] || null;
  }

  getPrimaryTab() {
    return this.getTabById(this.activeTabId) || this.tabs[0] || null;
  }

  getSecondaryTab() {
    if (!this.isSplit || !this.splitTabId) return null;
    return this.getTabById(this.splitTabId) || null;
  }

  getTabById(id) {
    return this.tabs.find((t) => t.id === id);
  }

  toggleSplitView(targetSecondaryTabId = null) {
    if (this.isSplit) {
      this.closeSplitView();
    } else {
      this.openSplitView(targetSecondaryTabId);
    }
  }

  openSplitView(targetSecondaryTabId = null) {
    if (this.tabs.length < 2) {
      const defaultAddress = getDefaultAddress();
      const defaultBmName = resolveBookmarkName(defaultAddress, settingsManager?.bookmarks) || '批踢踢實業坊';
      const freshTab = this.createTab({
        title: `${defaultBmName} (2)`,
        address: defaultAddress,
        encoding: 'big5',
        bookmarkName: defaultBmName,
      });
      targetSecondaryTabId = freshTab.id;
    }

    const primaryTab = this.getActiveTab();
    if (!primaryTab) return;

    let secondaryTab = null;
    if (targetSecondaryTabId && targetSecondaryTabId !== primaryTab.id) {
      secondaryTab = this.getTabById(targetSecondaryTabId);
    }
    if (!secondaryTab) {
      secondaryTab = this.tabs.find((t) => t.id !== primaryTab.id);
    }
    if (!secondaryTab) return;

    this.isSplit = true;
    this.activeTabId = primaryTab.id;
    this.splitTabId = secondaryTab.id;
    this.focusedTabId = primaryTab.id;

    this.renderSplitContainer();
    this.renderTabBar();
    this.onActiveTabChange?.(primaryTab);
  }

  closeSplitView() {
    if (!this.isSplit) return;
    this.isSplit = false;
    this.splitTabId = null;

    if (this.focusedTabId) {
      this.activeTabId = this.focusedTabId;
    }
    const activeTab = this.getActiveTab();
    this.focusedTabId = activeTab ? activeTab.id : null;

    if (activeTab && activeTab.view) {
      this.terminalContainerEl.replaceChildren(activeTab.view.wrapper);
      activeTab.view.setImeInput(this.imeInputEl);
      activeTab.view.resize();
      activeTab.view.redraw();
      activeTab.view.focus?.();
    }

    this.renderTabBar();
    this.onActiveTabChange?.(activeTab);
  }

  renderSplitContainer() {
    const primaryTab = this.getTabById(this.activeTabId);
    const secondaryTab = this.getTabById(this.splitTabId);
    if (!primaryTab || !secondaryTab) {
      this.closeSplitView();
      return;
    }

    const splitContainer = document.createElement('div');
    splitContainer.className = 'split-view-container';

    // Left Pane
    const leftPane = document.createElement('div');
    leftPane.className = `split-pane split-left ${this.focusedTabId === primaryTab.id ? 'focused' : ''}`;
    leftPane.dataset.tabId = primaryTab.id;
    if (primaryTab.view) {
      leftPane.appendChild(primaryTab.view.wrapper);
    }
    leftPane.addEventListener('mousedown', () => {
      this.focusSplitPane(primaryTab.id);
    });

    // Divider with resize drag support
    const divider = document.createElement('div');
    divider.className = 'split-divider';

    let isDragging = false;
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const rect = splitContainer.getBoundingClientRect();
        const offsetX = ev.clientX - rect.left;
        const pct = Math.max(20, Math.min(80, (offsetX / rect.width) * 100));
        leftPane.style.flex = `0 0 ${pct}%`;
        leftPane.style.width = `${pct}%`;
        rightPane.style.flex = `0 0 ${100 - pct}%`;
        rightPane.style.width = `${100 - pct}%`;
        primaryTab.view?.resize();
        secondaryTab.view?.resize();
      };

      const onMouseUp = () => {
        isDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        primaryTab.view?.resize();
        secondaryTab.view?.resize();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    divider.addEventListener('dblclick', () => {
      leftPane.style.flex = '1 1 50%';
      leftPane.style.width = '50%';
      rightPane.style.flex = '1 1 50%';
      rightPane.style.width = '50%';
      primaryTab.view?.resize();
      secondaryTab.view?.resize();
    });

    // Right Pane
    const rightPane = document.createElement('div');
    rightPane.className = `split-pane split-right ${this.focusedTabId === secondaryTab.id ? 'focused' : ''}`;
    rightPane.dataset.tabId = secondaryTab.id;
    if (secondaryTab.view) {
      rightPane.appendChild(secondaryTab.view.wrapper);
    }
    rightPane.addEventListener('mousedown', () => {
      this.focusSplitPane(secondaryTab.id);
    });

    splitContainer.appendChild(leftPane);
    splitContainer.appendChild(divider);
    splitContainer.appendChild(rightPane);

    this.terminalContainerEl.replaceChildren(splitContainer);

    // Set IME input to the focused pane
    const focusedTab = this.getTabById(this.focusedTabId) || primaryTab;
    if (focusedTab.view) {
      focusedTab.view.setImeInput(this.imeInputEl);
      focusedTab.view.focus?.();
    }

    // Resize and redraw both panes
    requestAnimationFrame(() => {
      primaryTab.view?.resize();
      primaryTab.view?.redraw();
      secondaryTab.view?.resize();
      secondaryTab.view?.redraw();
    });
  }

  focusSplitPane(tabId) {
    if (!this.isSplit) return;
    const tab = this.getTabById(tabId);
    if (!tab) return;

    this.focusedTabId = tabId;
    tab.unread = false;

    const panes = this.terminalContainerEl.querySelectorAll('.split-pane');
    panes.forEach((p) => {
      p.classList.toggle('focused', p.dataset.tabId === tabId);
    });

    if (tab.view) {
      tab.view.setImeInput(this.imeInputEl);
      tab.view.focus?.();
    }

    this.renderTabBar();
    this.onActiveTabChange?.(tab);
  }

  switchTab(tabId) {
    const targetTab = this.getTabById(tabId);
    if (!targetTab) return;

    targetTab.unread = false;

    if (this.isSplit) {
      if (tabId === this.activeTabId) {
        this.focusSplitPane(this.activeTabId);
        return;
      }
      if (tabId === this.splitTabId) {
        this.focusSplitPane(this.splitTabId);
        return;
      }
      // Replace whichever pane currently has focus
      if (this.focusedTabId === this.splitTabId) {
        this.splitTabId = tabId;
      } else {
        this.activeTabId = tabId;
      }
      this.focusedTabId = tabId;
      this.renderSplitContainer();
      this.renderTabBar();
      this.onActiveTabChange?.(targetTab);
      return;
    }

    this.activeTabId = tabId;

    // Attach active tab's view wrapper to container & re-hook imeInput
    if (targetTab.view) {
      this.terminalContainerEl.replaceChildren(targetTab.view.wrapper);
      targetTab.view.setImeInput(this.imeInputEl);
      targetTab.view.resize();
      targetTab.view.redraw();
      targetTab.view.focus?.();
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
      if (this.isSplit) {
        this.isSplit = false;
        this.splitTabId = null;
      }
      const defaultAddress = getDefaultAddress();
      const defaultBmName = resolveBookmarkName(defaultAddress, settingsManager?.bookmarks) || '批踢踢實業坊';
      const freshTab = this.createTab({
        title: defaultBmName,
        address: defaultAddress,
        encoding: 'big5',
        bookmarkName: defaultBmName,
      });
      this.switchTab(freshTab.id);
      return;
    }

    if (this.isSplit) {
      if (this.tabs.length < 2) {
        this.isSplit = false;
        this.splitTabId = null;
        this.activeTabId = this.tabs[0].id;
        this.switchTab(this.tabs[0].id);
        return;
      }
      if (tabId === this.activeTabId || tabId === this.splitTabId) {
        const replacement = this.tabs.find((t) => t.id !== this.activeTabId && t.id !== this.splitTabId) || this.tabs[0];
        if (tabId === this.activeTabId) {
          this.activeTabId = replacement.id;
          this.focusedTabId = this.activeTabId;
        } else {
          this.splitTabId = replacement.id;
          this.focusedTabId = this.splitTabId;
        }
        this.renderSplitContainer();
        this.renderTabBar();
        return;
      }
      this.renderTabBar();
      return;
    }

    // Switch to adjacent tab if active tab was closed
    if (this.activeTabId === tabId) {
      const nextIdx = Math.max(0, idx - 1);
      this.switchTab(this.tabs[nextIdx].id);
    } else {
      this.renderTabBar();
    }
  }

  updateTabStatus(tabId, status) {
    const tab = this.getTabById(tabId);
    if (tab) {
      tab.status = status;
      if (status === 'connected' || status === 'connecting') {
        const bmName = tab.bookmarkName || resolveBookmarkName(tab.address, settingsManager?.bookmarks);
        if (bmName) {
          tab.title = bmName;
          tab.bookmarkName = bmName;
        } else {
          const cleanHost = extractHostFromAddress(tab.address);
          if (cleanHost.includes('ptt.cc')) tab.title = '批踢踢實業坊';
          else if (cleanHost.includes('ptt2.cc')) tab.title = '批踢踢兔';
          else if (cleanHost.includes('duckdns') || cleanHost.includes('ncku')) tab.title = '成大物治';
          else if (cleanHost.includes('gamer')) tab.title = '巴哈姆特';
          else if (cleanHost) tab.title = cleanHost;
        }
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
      const isVisible = this.isSplit
        ? (tabId === this.activeTabId || tabId === this.splitTabId)
        : (this.activeTabId === tabId);
      if (!isVisible) {
        tab.unread = true;
        this.renderTabBar();
      }
      this.onTabData?.(tab);
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
      
      let isTabActive = false;
      let paneBadgeText = null;

      if (this.isSplit) {
        if (tab.id === this.activeTabId) {
          isTabActive = this.focusedTabId === tab.id;
          tabEl.classList.add('split-pane-tab', 'split-left');
          paneBadgeText = '左';
        } else if (tab.id === this.splitTabId) {
          isTabActive = this.focusedTabId === tab.id;
          tabEl.classList.add('split-pane-tab', 'split-right');
          paneBadgeText = '右';
        }
      } else {
        isTabActive = tab.id === this.activeTabId;
      }

      tabEl.className = `bbs-tab ${isTabActive ? 'active' : ''} ${tabEl.className}`.trim();
      tabEl.dataset.tabId = tab.id;

      // Status indicator dot
      const dot = document.createElement('span');
      dot.className = `bbs-tab-dot ${tab.status}`;
      tabEl.appendChild(dot);

      // Pane badge if split mode
      if (paneBadgeText) {
        const badge = document.createElement('span');
        badge.className = 'bbs-tab-pane-badge';
        badge.textContent = paneBadgeText;
        tabEl.appendChild(badge);
      }

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
      closeBtn.title = getShortcutTooltip('close_tab', resolveEnv({ isMac }));
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };
      tabEl.appendChild(closeBtn);

      tabEl.onclick = () => this.switchTab(tab.id);
      tabEl.oncontextmenu = (e) => {
        e.preventDefault();
        if (this.isSplit) {
          if (this.activeTabId === tab.id || this.splitTabId === tab.id) {
            this.closeSplitView();
          } else {
            this.splitTabId = tab.id;
            this.focusSplitPane(tab.id);
            this.renderSplitContainer();
          }
        } else {
          this.openSplitView(tab.id);
        }
      };
      tabList.appendChild(tabEl);
    });

    // New Tab button [+] appended inside tabList directly behind the last active tab
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'bbs-tab-new';
    newTabBtn.innerHTML = '＋';
    newTabBtn.title = getShortcutTooltip('new_tab', resolveEnv({ isMac }));
    newTabBtn.onclick = () => {
      const newTab = this.createTab({
        title: `連線 ${this.tabs.length + 1}`,
        address: getDefaultAddress(),
        encoding: 'big5',
      });
      this.switchTab(newTab.id);
    };
    tabList.appendChild(newTabBtn);

    // Split View toggle button [◫]
    const splitBtn = document.createElement('button');
    splitBtn.className = `bbs-tab-split-btn ${this.isSplit ? 'active' : ''}`;
    splitBtn.title = getShortcutTooltip('toggle_split_view', resolveEnv({ isMac }));
    splitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H7V3H2.5zm5.5 0v10h5.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5H8z"/>
    </svg>`;
    splitBtn.onclick = () => {
      this.toggleSplitView();
    };
    tabList.appendChild(splitBtn);

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
