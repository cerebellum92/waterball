// Floating Screen Text Search Widget (Cmd+F) for bbsterm

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
      <button id="search-btn-prev" class="search-nav-btn" title="上一處 (Shift+Enter / Cmd+Shift+G)">▲</button>
      <button id="search-btn-next" class="search-nav-btn" title="下一處 (Enter / Cmd+G)">▼</button>
      <button id="search-btn-case" class="search-opt-btn" title="區分大小寫">Aa</button>
      <button id="search-btn-close" class="search-close-btn" title="關閉搜尋 (ESC)">✕</button>
    `;

    document.body.appendChild(widget);

    this.widgetEl = widget;
    this.inputEl = widget.querySelector('#search-input');
    this.countEl = widget.querySelector('#search-count-label');
    this.btnPrev = widget.querySelector('#search-btn-prev');
    this.btnNext = widget.querySelector('#search-btn-next');
    this.btnCase = widget.querySelector('#search-btn-case');
    this.btnClose = widget.querySelector('#search-btn-close');

    // Input events
    this.inputEl.addEventListener('input', () => this.performSearch());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.prevMatch();
        } else {
          this.nextMatch();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
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
