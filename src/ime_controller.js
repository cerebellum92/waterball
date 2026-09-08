// IME & Terminal Focus Controller for Waterball BBS

export class ImeController {
  constructor({
    imeInput,
    terminalContainer,
    tabManager,
    onSendData,
    getModalOpenStates,
  }) {
    this.imeInput = imeInput;
    this.terminalContainer = terminalContainer;
    this.tabManager = tabManager;
    this.onSendData = onSendData || (() => {});
    this.getModalOpenStates = getModalOpenStates || (() => false);

    this.isComposing = false;

    this.initEventListeners();
  }

  initEventListeners() {
    if (!this.imeInput) return;

    // Click on terminal container focuses IME input
    if (this.terminalContainer) {
      this.terminalContainer.addEventListener('click', () => {
        this.focusTerminal(true);
      });
    }

    // Window click outside interactive elements returns focus to terminal
    window.addEventListener('click', (e) => {
      if (this.getModalOpenStates()) return;
      if (
        e.target.closest('#settings-modal') ||
        e.target.closest('#push-modal') ||
        e.target.closest('#article-reader-modal') ||
        e.target.closest('#reader-lightbox') ||
        e.target.closest('#search-bar-widget') ||
        e.target.closest('#palette-widget') ||
        e.target.closest('#export-modal') ||
        e.target.closest('#board-switcher-widget') ||
        e.target.closest('#toolbar') ||
        e.target.closest('#tab-bar')
      ) {
        return;
      }
      this.focusTerminal();
    });

    window.addEventListener('resize', () => {
      this.hideImeBubble();
    });

    window.addEventListener('blur', () => {
      this.hideImeBubble();
    });

    // IME Composition Events (注音 / 倉頡 / 拼音 中文輸入法)
    this.imeInput.addEventListener('compositionstart', (e) => {
      this.isComposing = true;
      this.imeInput.dataset.composing = 'true';
      this.imeInput.classList.add('composing');
      this.updateImeBubble(e.data || this.imeInput.value || '');
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab && activeTab.view) {
        activeTab.view.updateImePosition();
      }
    });

    this.imeInput.addEventListener('compositionupdate', (e) => {
      this.isComposing = true;
      this.imeInput.dataset.composing = 'true';
      this.imeInput.classList.add('composing');
      this.updateImeBubble(e.data || this.imeInput.value || '');
    });

    this.imeInput.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.imeInput.dataset.composing = 'false';
      this.imeInput.classList.remove('composing');
      this.hideImeBubble();

      // In standard W3C DOM, text input is dispatched via the `input` event immediately after compositionend.
      // queueMicrotask fallback ensures text is dispatched even in environments where input event might not fire.
      queueMicrotask(() => {
        if (!this.isComposing && this.imeInput.value) {
          const text = this.imeInput.value;
          this.imeInput.value = '';
          this.onSendData(text.replace(/\r\n/g, '\r').replace(/\n/g, '\r'));
        }
      });

      const activeTab = this.tabManager.getActiveTab();
      if (activeTab && activeTab.view) {
        activeTab.view.updateImePosition();
      }
    });

    this.imeInput.addEventListener('input', (e) => {
      // During active composition, update floating bubble and do not commit yet
      if (this.isComposing || (e && e.isComposing)) {
        this.updateImeBubble(e.data || this.imeInput.value || '');
        return;
      }

      const text = this.imeInput.value;
      this.imeInput.value = '';

      if (text) {
        this.onSendData(text.replace(/\r\n/g, '\r').replace(/\n/g, '\r'));
      }
    });
  }

  focusTerminal(force = false) {
    if (this.getModalOpenStates()) return;

    if (!force) {
      if (
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'SELECT' ||
          document.activeElement.tagName === 'BUTTON' ||
          (document.activeElement.tagName === 'TEXTAREA' && document.activeElement !== this.imeInput))
      ) {
        return;
      }
    } else {
      if (document.activeElement && document.activeElement !== this.imeInput && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    }

    if (this.imeInput) {
      this.imeInput.focus();
    }
  }

  updateImeBubble(text = '') {
    const el = document.getElementById('ime-bubble');
    const txtEl = document.getElementById('ime-bubble-text');
    if (!el || !txtEl) return;

    const str = text || this.imeInput?.value || '';
    if (!str) {
      this.hideImeBubble();
      return;
    }

    const activeTab = this.tabManager.getActiveTab();
    const view = activeTab?.view;
    if (!view || !view.canvas) {
      this.hideImeBubble();
      return;
    }

    const canvasRect = view.canvas.getBoundingClientRect();
    const curX = canvasRect.left + (activeTab.buf.cur_x * view.cellW);
    const curY = canvasRect.top + (activeTab.buf.cur_y * view.cellH);
    const cellH = view.cellH;

    txtEl.textContent = str;
    el.classList.remove('hidden');
    el.style.display = 'flex';

    let left = curX;
    let top = curY + cellH + 4;

    const bubbleRect = el.getBoundingClientRect();
    if (top + (bubbleRect.height || 26) > window.innerHeight - 8) {
      top = Math.max(8, curY - (bubbleRect.height || 26) - 4);
    }
    if (left + (bubbleRect.width || 80) > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - (bubbleRect.width || 80) - 8);
    }

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  hideImeBubble() {
    const el = document.getElementById('ime-bubble');
    const txtEl = document.getElementById('ime-bubble-text');
    if (el) {
      el.classList.add('hidden');
      el.style.display = 'none';
    }
    if (txtEl) {
      txtEl.textContent = '';
    }
  }
}
