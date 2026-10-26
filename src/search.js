// Floating Screen Text Search Widget (Cmd+F / Ctrl+Shift+F) for bbsterm
import { isMac } from './keymap.js';

export class SearchWidget {
  constructor(getTabCallback) {
    this.getTab = getTabCallback;
    this.isOpen = false;
    this.matches = [];
    this.currentIndex = -1;
    this.caseSensitive = false;

    this.widgetEl = null;
    this.inputEl = null;
    this.countEl = null;
    this.btnPrev = null;
    this.btnNext = null;
    this.btnCase = null;
    this.btnClose = null;

    this.createDom();
  }

  createDom() {
    const widget = document.createElement('div');
    widget.id = 'search-bar-widget';
    widget.className = 'search-bar-widget hidden';

    widget.innerHTML = `
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" id="search-input" placeholder="搜尋畫面文字..." autocomplete="off" spellcheck="false" />
        <span id="search-count-label" class="search-count-label"></span>
      </div>
      <button id="search-btn-prev" class="search-nav-btn" title="${isMac ? '上一處 (Shift+Enter / Cmd+Shift+G / Shift+F3)' : '上一處 (Shift+Enter / Shift+F3)'}">▲</button>
      <button id="search-btn-next" class="search-nav-btn" title="${isMac ? '下一處 (Enter / Cmd+G / F3)' : '下一處 (Enter / F3)'}">▼</button>
      <button id="search-btn-case" class="search-opt-btn" title="區分大小寫">Aa</button>
      <button id="search-btn-close" class="search-close-btn" title="關閉搜尋 (ESC)">✕</button>
    `;

    document.body.appendChild(widget);

    this.widgetEl = widget;
    this.inputWrapper = widget.querySelector('.search-input-wrapper');
    this.inputEl = widget.querySelector('#search-input');
    this.countEl = widget.querySelector('#search-count-label');
    this.btnPrev = widget.querySelector('#search-btn-prev');
    this.btnNext = widget.querySelector('#search-btn-next');
    this.btnCase = widget.querySelector('#search-btn-case');
    this.btnClose = widget.querySelector('#search-btn-close');

    // IME composition state tracking
    let isComposing = false;
    let compositionJustEnded = false;
    let compositionCancelled = false;
    let valueBeforeComposition = '';
    let compositionEndTimer = null;

    this.inputEl.addEventListener('compositionstart', () => {
      isComposing = true;
      compositionCancelled = false;
      compositionJustEnded = false;
      clearTimeout(compositionEndTimer);
      valueBeforeComposition = this.inputEl.value || '';
      this.inputWrapper?.classList.add('composing');
      this.inputEl.classList.add('composing');
    });

    this.inputEl.addEventListener('compositionupdate', () => {
      isComposing = true;
      this.inputWrapper?.classList.add('composing');
      this.inputEl.classList.add('composing');
    });

    this.inputEl.addEventListener('compositionend', () => {
      this.inputWrapper?.classList.remove('composing');
      this.inputEl.classList.remove('composing');
      if (compositionCancelled) {
        compositionCancelled = false;
        isComposing = false;
        this.inputEl.value = valueBeforeComposition;
        this.performSearch();
        return;
      }
      isComposing = false;
      compositionJustEnded = true;
      clearTimeout(compositionEndTimer);
      compositionEndTimer = setTimeout(() => {
        compositionJustEnded = false;
      }, 100);
      this.performSearch();
    });

    // Input events: do NOT trigger search mid-composition so native IME candidate
    // dropdowns (e.g. macOS Zhuyin / McBopomofo) are not prematurely committed by DOM mutations.
    this.inputEl.addEventListener('input', (e) => {
      if (compositionCancelled) {
        this.inputEl.value = valueBeforeComposition;
        return;
      }
      if (isComposing || (e && e.isComposing)) return;
      this.performSearch();
    });

    this.inputEl.addEventListener('keydown', (e) => {
      // Escape during or immediately following composition:
      // Revert unfinished phonetic/candidate text to pre-composition state without closing the search widget.
      if (e.key === 'Escape' && (isComposing || e.isComposing || compositionJustEnded)) {
        compositionCancelled = true;
        isComposing = false;
        compositionJustEnded = false;
        clearTimeout(compositionEndTimer);
        this.inputWrapper?.classList.remove('composing');
        this.inputEl.classList.remove('composing');
        this.inputEl.value = valueBeforeComposition;
        this.performSearch();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // This target handler runs before the window-level IME guard.
      if (isComposing || e.isComposing || e.key === 'Process' || e.keyCode === 229) return;
      if (compositionJustEnded) {
        compositionJustEnded = false;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (e.key === 'F3') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          this.prevMatch();
        } else {
          this.nextMatch();
        }
        return;
      }
      if (isMac && e.metaKey && !e.ctrlKey && !e.altKey && (e.code === 'KeyG' || e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          this.prevMatch();
        } else {
          this.nextMatch();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          this.prevMatch();
        } else {
          this.nextMatch();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    // Nav buttons
    this.btnPrev.addEventListener('click', () => this.prevMatch());
    this.btnNext.addEventListener('click', () => this.nextMatch());

    // Case sensitive toggle
    this.btnCase.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.btnCase.classList.toggle('active', this.caseSensitive);
      this.performSearch();
    });

    // Close button
    this.btnClose.addEventListener('click', () => this.close());
  }

  open() {
    this.isOpen = true;
    this.widgetEl.classList.remove('hidden');
    this.inputEl.focus();
    this.inputEl.select();

    if (this.inputEl.value) {
      this.performSearch();
    }
  }

  close() {
    this.isOpen = false;
    this.widgetEl.classList.add('hidden');
    this.inputWrapper?.classList.remove('composing');
    this.inputEl?.classList.remove('composing');
    this.matches = [];
    this.currentIndex = -1;

    const tab = this.getTab?.();
    if (tab?.view) {
      tab.view.clearSearch();
    }
  }

  performSearch() {
    const tab = this.getTab?.();
    if (!tab || !tab.buf || !tab.view) return;

    const query = this.inputEl.value;
    if (!query || query.trim() === '') {
      this.matches = [];
      this.currentIndex = -1;
      this.countEl.textContent = '';
      this.countEl.className = 'search-count-label';
      tab.view.clearSearch();
      return;
    }

    this.matches = tab.buf.findMatches(query, this.caseSensitive);

    if (this.matches.length > 0) {
      this.currentIndex = 0;
      this.countEl.textContent = `1 / ${this.matches.length}`;
      this.countEl.className = 'search-count-label found';
      tab.view.setSearchResults(this.matches, this.currentIndex);
    } else {
      this.currentIndex = -1;
      this.countEl.textContent = '無相符項目';
      this.countEl.className = 'search-count-label not-found';
      tab.view.clearSearch();
    }
  }

  nextMatch() {
    if (this.matches.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    this.updateActiveMatch();
  }

  prevMatch() {
    if (this.matches.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    this.updateActiveMatch();
  }

  updateActiveMatch() {
    const tab = this.getTab?.();
    if (!tab?.view) return;

    this.countEl.textContent = `${this.currentIndex + 1} / ${this.matches.length}`;
    tab.view.setSearchResults(this.matches, this.currentIndex);
  }
}
