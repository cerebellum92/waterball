// Floating Mouse Navigation Dock & Desktop Terminal Aspect-Ratio Fit Helpers

export const FLOATING_NAV_ACTIONS = [
  { id: 'top', icon: '⤒', label: '頂', title: '到最頂 (Home)', seq: '\x1b[1~' },
  { id: 'pageUp', icon: '▲', label: '上頁', title: '往上一頁 (PageUp)', seq: '\x1b[5~' },
  { id: 'back', icon: '←', label: '退出', title: '退出 / 返回上一層 (←)', seq: '\x1b[D' },
  { id: 'pageDown', icon: '▼', label: '下頁', title: '往下一頁 (PageDown)', seq: '\x1b[6~' },
  { id: 'bottom', icon: '⤓', label: '底', title: '到最底 (End)', seq: '\x1b[4~' },
];

/**
 * Computes fixed-viewport coordinates for the floating mouse navigation dock.
 * Prioritizes placing the dock cleanly inside the right blank margin when wide
 * enough; otherwise overlays the right edge without shrinking terminal cells.
 */
export function computeFloatingDockLayout({
  containerRect,
  canvasRect = null,
  dockWidth = 44,
  dockHeight = 250,
  gap = 10,
  edgeMargin = 10,
} = {}) {
  const cLeft = Number(containerRect?.left) || 0;
  const cTop = Number(containerRect?.top) || 0;
  const cRight = Number(containerRect?.right) || (cLeft + (Number(containerRect?.width) || 0));
  const cBottom = Number(containerRect?.bottom) || (cTop + (Number(containerRect?.height) || 0));
  const hasCanvas = Boolean(canvasRect && Number(canvasRect.width) > 0 && Number(canvasRect.height) > 0);
  const cvRight = hasCanvas ? Number(canvasRect.right) : cRight;
  const rightMargin = Math.max(0, cRight - cvRight);

  let mode = 'overlay';
  let left = Math.round(Math.max(cLeft + 6, cRight - dockWidth - edgeMargin));

  if (hasCanvas && rightMargin >= dockWidth + gap + 6) {
    mode = 'margin';
    const centeredOffset = Math.max(gap, (rightMargin - dockWidth) / 2);
    const preferredLeft = cvRight + Math.min(gap + 12, centeredOffset);
    left = Math.round(Math.min(cRight - dockWidth - 6, Math.max(cvRight + gap, preferredLeft)));
  }

  const refTop = hasCanvas ? Number(canvasRect.top) : cTop;
  const refHeight = hasCanvas ? Number(canvasRect.height) : Math.max(0, cBottom - cTop);
  const rawTop = refTop + (refHeight - dockHeight) / 2;
  const minTop = cTop + 8;
  const maxTop = Math.max(minTop, cBottom - dockHeight - 8);
  const top = Math.round(Math.max(minTop, Math.min(maxTop, rawTop)));

  return { mode, left, top, rightMargin };
}

/**
 * Computes a viewport (innerWidth x innerHeight) size that wraps the 80x24 (2:1 cell)
 * terminal canvas tightly with minimal excess blank margins.
 */
export function computeWindowFitInnerSize({
  innerWidth,
  innerHeight,
  containerWidth,
  containerHeight,
  padX = 0,
  padY = 0,
  dpr = 1,
  prevInnerWidth = null,
  prevInnerHeight = null,
  mode = 'shrink',
  maxInnerWidth = Infinity,
  maxInnerHeight = Infinity,
  minWidth = 360,
  minHeight = 360,
} = {}) {
  const safeInnerW = Math.max(minWidth, Number(innerWidth) || 800);
  const safeInnerH = Math.max(minHeight, Number(innerHeight) || 500);
  const safeContainerW = Math.max(100, Number(containerWidth) || safeInnerW);
  const safeContainerH = Math.max(100, Number(containerHeight) || safeInnerH);
  const safeDpr = (typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0) ? dpr : 1;

  const chromeW = Math.max(0, safeInnerW - safeContainerW);
  const chromeH = Math.max(0, safeInnerH - safeContainerH);

  const availW = Math.max(100, safeContainerW - padX - 8);
  const availH = Math.max(100, safeContainerH - padY - 8);

  const maxAvailW = Number.isFinite(maxInnerWidth)
    ? Math.max(100, maxInnerWidth - chromeW - padX - 8)
    : availW;
  const maxAvailH = Number.isFinite(maxInnerHeight)
    ? Math.max(100, maxInnerHeight - chromeH - padY - 8)
    : availH;
  const maxPhysCellW = Math.max(4, Math.floor(Math.min((maxAvailW * safeDpr) / 80, (maxAvailH * safeDpr) / 48)));

  let physCellW = Math.max(4, Math.floor(Math.min((availW * safeDpr) / 80, (availH * safeDpr) / 48)));

  if (mode === 'auto' && Number.isFinite(prevInnerWidth) && Number.isFinite(prevInnerHeight)) {
    const dw = safeInnerW - prevInnerWidth;
    const dh = safeInnerH - prevInnerHeight;
    if (dw > 4 && Math.abs(dw) > Math.abs(dh) + 4) {
      physCellW = Math.max(4, Math.floor((availW * safeDpr) / 80));
    } else if (dh > 4 && Math.abs(dh) > Math.abs(dw) + 4) {
      physCellW = Math.max(4, Math.floor((availH * safeDpr) / 48));
    }
  }

  physCellW = Math.min(physCellW, maxPhysCellW);

  const targetContainerW = Math.ceil((physCellW * 80) / safeDpr + padX + 8);
  const targetContainerH = Math.ceil((physCellW * 48) / safeDpr + padY + 8);

  const rawWidth = Math.round(targetContainerW + chromeW);
  const rawHeight = Math.round(targetContainerH + chromeH);

  const width = Math.max(minWidth, Math.min(maxInnerWidth, rawWidth));
  const height = Math.max(minHeight, Math.min(maxInnerHeight, rawHeight));
  const changed = Math.abs(width - safeInnerW) > 4 || Math.abs(height - safeInnerH) > 4;

  return { width, height, physCellW, changed };
}

export class FloatingNavDock {
  constructor({
    rootEl,
    enabled = true,
    collapsed = false,
    canFitWindow = false,
    onSendAction = null,
    onFitWindow = null,
    onFocusTerminal = null,
    onCollapsedChange = null,
  } = {}) {
    this.rootEl = rootEl || null;
    this.enabled = enabled !== false;
    this.collapsed = Boolean(collapsed);
    this.canFitWindow = Boolean(canFitWindow);
    this.onSendAction = onSendAction;
    this.onFitWindow = onFitWindow;
    this.onFocusTerminal = onFocusTerminal;
    this.onCollapsedChange = onCollapsedChange;

    this.panelEl = null;
    this.reopenBtn = null;
    this._render();
  }

  _render() {
    if (!this.rootEl || typeof document === 'undefined') return;
    this.rootEl.replaceChildren();

    const preventFocusSteal = (e) => {
      e.preventDefault();
    };
    this.rootEl.addEventListener('mousedown', preventFocusSteal);

    const panel = document.createElement('div');
    panel.className = 'floating-nav-panel';

    for (const action of FLOATING_NAV_ACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'floating-nav-btn';
      btn.dataset.action = action.id;
      btn.title = action.title;
      btn.setAttribute('aria-label', action.title);

      const iconSpan = document.createElement('span');
      iconSpan.className = 'floating-nav-icon';
      iconSpan.textContent = action.icon;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'floating-nav-label';
      labelSpan.textContent = action.label;

      btn.append(iconSpan, labelSpan);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSendAction?.(action.seq, action.id);
        this.onFocusTerminal?.(false);
      });
      panel.appendChild(btn);
    }

    if (this.canFitWindow) {
      const divider = document.createElement('div');
      divider.className = 'floating-nav-divider';
      panel.appendChild(divider);

      const fitBtn = document.createElement('button');
      fitBtn.type = 'button';
      fitBtn.className = 'floating-nav-btn floating-nav-fit-btn';
      fitBtn.dataset.action = 'fit';
      fitBtn.title = '一鍵貼合終端機比例（消除多餘黑邊）';
      fitBtn.setAttribute('aria-label', '一鍵貼合終端機比例');

      const fitIcon = document.createElement('span');
      fitIcon.className = 'floating-nav-icon';
      fitIcon.textContent = '⊡';

      const fitLabel = document.createElement('span');
      fitLabel.className = 'floating-nav-label';
      fitLabel.textContent = '貼合';

      fitBtn.append(fitIcon, fitLabel);
      fitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onFitWindow?.();
        this.onFocusTerminal?.(false);
      });
      panel.appendChild(fitBtn);
    }

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'floating-nav-collapse-btn';
    collapseBtn.title = '收合滑鼠導覽列';
    collapseBtn.setAttribute('aria-label', '收合滑鼠導覽列');
    collapseBtn.textContent = '›';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setCollapsed(true);
      this.onFocusTerminal?.(false);
    });
    panel.appendChild(collapseBtn);

    const reopenBtn = document.createElement('button');
    reopenBtn.type = 'button';
    reopenBtn.className = 'floating-nav-reopen';
    reopenBtn.title = '展開滑鼠導覽列';
    reopenBtn.setAttribute('aria-label', '展開滑鼠導覽列');
    reopenBtn.textContent = '‹';
    reopenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setCollapsed(false);
      this.onFocusTerminal?.(false);
    });

    this.panelEl = panel;
    this.reopenBtn = reopenBtn;
    this.rootEl.append(panel, reopenBtn);
  }

  setEnabled(enabled) {
    this.enabled = enabled !== false;
    if (!this.enabled && this.rootEl) {
      this.rootEl.classList.add('hidden');
    }
  }

  setCollapsed(collapsed) {
    const next = Boolean(collapsed);
    if (this.collapsed === next) return;
    this.collapsed = next;
    this.rootEl?.classList.toggle('is-collapsed', next);
    this.onCollapsedChange?.(next);
  }

  update({
    isSplit = false,
    isMobile = false,
    isConnected = false,
    containerEl = null,
    canvasEl = null,
  } = {}) {
    if (!this.rootEl) return;
    if (!this.enabled || isSplit || isMobile || !containerEl) {
      this.rootEl.classList.add('hidden');
      return;
    }

    this.rootEl.classList.remove('hidden');
    this.rootEl.classList.toggle('is-collapsed', this.collapsed);
    this.rootEl.classList.toggle('is-disconnected', !isConnected);

    const containerRect = containerEl.getBoundingClientRect?.();
    if (!containerRect || containerRect.width <= 0 || containerRect.height <= 0) {
      return;
    }

    if (this.collapsed) {
      const handleW = 20;
      const handleH = 52;
      const left = Math.round(Math.max(containerRect.left, containerRect.right - handleW));
      const top = Math.round(containerRect.top + Math.max(8, (containerRect.height - handleH) / 2));
      this.rootEl.classList.remove('mode-margin');
      this.rootEl.classList.add('mode-overlay');
      this.rootEl.style.left = `${left}px`;
      this.rootEl.style.top = `${top}px`;
      return;
    }

    const canvasRect = canvasEl?.getBoundingClientRect?.() || null;
    const dockWidth = this.panelEl?.offsetWidth || this.rootEl.offsetWidth || 44;
    const dockHeight = this.panelEl?.offsetHeight || this.rootEl.offsetHeight || (this.canFitWindow ? 278 : 228);

    const layout = computeFloatingDockLayout({
      containerRect,
      canvasRect,
      dockWidth,
      dockHeight,
    });

    this.rootEl.classList.toggle('mode-margin', layout.mode === 'margin');
    this.rootEl.classList.toggle('mode-overlay', layout.mode === 'overlay');
    this.rootEl.style.left = `${layout.left}px`;
    this.rootEl.style.top = `${layout.top}px`;
  }
}
