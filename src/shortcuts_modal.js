import { isMac } from './keymap.js';
import { SHORTCUTS_REGISTRY, SHORTCUT_CATEGORIES, getShortcutKeys, resolveEnv } from './shortcuts_config.js';

export class ShortcutsModal {
  constructor() {
    this.modalEl = document.getElementById('shortcuts-modal');
    this.bodyEl = this.modalEl?.querySelector?.('.shortcuts-modal-body') || null;
    this.closeBtn = document.getElementById('shortcuts-close-btn');
    this.tabAuto = document.getElementById('shortcuts-tab-auto');
    this.tabWin = document.getElementById('shortcuts-tab-win');
    this.tabMac = document.getElementById('shortcuts-tab-mac');
    this.activePlatform = isMac ? 'mac' : 'win';

    this.render();
    this.init();
  }

  render() {
    if (!this.bodyEl) return;
    const categories = ['common', 'tabs', 'search', 'bbs'];
    let html = '<div class="shortcuts-grid">';

    categories.forEach((cat) => {
      const title = SHORTCUT_CATEGORIES[cat] || cat;
      const items = SHORTCUTS_REGISTRY.filter((item) => item.category === cat);
      html += `
        <div class="shortcuts-group">
          <h3>${title}</h3>
          <table class="shortcuts-table">
            ${items
              .map(
                (item) => `
              <tr>
                <td>${item.name}</td>
                <td>
                  <kbd class="key-win">${getShortcutKeys(item.id, resolveEnv({ isMac: false }))}</kbd>
                  <kbd class="key-mac">${getShortcutKeys(item.id, resolveEnv({ isMac: true }))}</kbd>
                </td>
                <td>${item.description || ''}</td>
              </tr>
            `
              )
              .join('')}
          </table>
        </div>
      `;
    });

    html += '</div>';
    this.bodyEl.innerHTML = html;
  }

  init() {
    this.closeBtn?.addEventListener('click', () => this.close());
    this.modalEl?.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.close();
    });

    this.tabAuto?.addEventListener('click', () => this.setPlatform('auto'));
    this.tabWin?.addEventListener('click', () => this.setPlatform('win'));
    this.tabMac?.addEventListener('click', () => this.setPlatform('mac'));
  }

  setPlatform(mode) {
    const target = mode === 'auto' ? (isMac ? 'mac' : 'win') : mode;
    this.activePlatform = target;

    [this.tabAuto, this.tabWin, this.tabMac].forEach((btn) => btn?.classList.remove('active'));
    if (mode === 'auto') this.tabAuto?.classList.add('active');
    else if (mode === 'win') this.tabWin?.classList.add('active');
    else if (mode === 'mac') this.tabMac?.classList.add('active');

    if (this.modalEl) {
      this.modalEl.classList.toggle('view-mac', target === 'mac');
      this.modalEl.classList.toggle('view-win', target === 'win');
    }
  }

  open() {
    if (!this.modalEl) return;
    this.setPlatform('auto');
    this.modalEl.classList.remove('hidden');
  }

  close() {
    if (!this.modalEl) return;
    this.modalEl.classList.add('hidden');
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  isOpen() {
    return Boolean(this.modalEl && !this.modalEl.classList.contains('hidden'));
  }
}
