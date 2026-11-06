import { openExternalUrl } from './platform.js';

export function formatReleaseNotesHtml(rawText, releaseUrl = '') {
  if (!rawText || typeof rawText !== 'string') {
    return '<p class="update-notes-empty">包含效能提升與已知問題修復。</p>';
  }

  // 1. Strip installation / download instructions boilerplate if present
  let cleanText = rawText;
  const cutOffPatterns = [
    /\n#{1,4}\s*📦\s*(?:各作業系統下載|下載與安裝說明|下載說明|Installation|Downloads)/i,
    /\n---\s*\n\s*#{1,4}\s*📦/i,
    /\n---\s*\n\s*#{1,4}\s*Downloads/i,
  ];
  for (const pattern of cutOffPatterns) {
    const idx = cleanText.search(pattern);
    if (idx !== -1) {
      cleanText = cleanText.slice(0, idx).trim();
      break;
    }
  }

  const escapeHtml = (str) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const lines = cleanText.split('\n');
  const htmlParts = [];
  let inList = false;

  const closeListIfNeeded = () => {
    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Subheadings (#### or ###)
    if (line.startsWith('#### ') || line.startsWith('### ')) {
      closeListIfNeeded();
      const headingText = escapeHtml(line.replace(/^#{3,4}\s+/, '').replace(/\*\*/g, '').trim());
      htmlParts.push(`<div class="update-notes-subheading">${headingText}</div>`);
      continue;
    }
    // Main headings (## or #)
    if (line.startsWith('## ') || line.startsWith('# ')) {
      closeListIfNeeded();
      const headingText = escapeHtml(line.replace(/^#{1,2}\s+/, '').replace(/\*\*/g, '').trim());
      htmlParts.push(`<div class="update-notes-heading">${headingText}</div>`);
      continue;
    }

    // Horizontal rule
    if (line === '---' || line === '***') {
      closeListIfNeeded();
      continue;
    }

    // Bullet points (- or * or numbered 1.)
    if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\.\s+/.test(line)) {
      if (!inList) {
        htmlParts.push('<ul class="update-notes-list">');
        inList = true;
      }
      let content = line.replace(/^[-*]\s+|\d+\.\s+/, '');
      content = escapeHtml(content);
      content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
      htmlParts.push(`<li>${content}</li>`);
      continue;
    }

    // Regular paragraph
    closeListIfNeeded();
    let pContent = escapeHtml(line);
    pContent = pContent.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    pContent = pContent.replace(/`([^`]+)`/g, '<code>$1</code>');
    htmlParts.push(`<p class="update-notes-p">${pContent}</p>`);
  }

  closeListIfNeeded();

  if (releaseUrl) {
    htmlParts.push(
      `<div class="update-notes-more"><a href="${escapeHtml(releaseUrl)}" class="update-more-link" target="_blank" rel="noopener noreferrer">👉 前往 GitHub 查看完整更新日誌 ↗</a></div>`
    );
  }

  return htmlParts.join('') || '<p class="update-notes-empty">包含效能提升與已知問題修復。</p>';
}

export class UpdateModal {
  constructor() {
    this.modalEl = document.getElementById('update-modal');
    this.closeBtn = document.getElementById('update-modal-close-btn');
    this.dismissBtn = document.getElementById('update-modal-dismiss-btn');
    this.downloadBtn = document.getElementById('update-modal-download-btn');
    this.currentVerEl = document.getElementById('update-modal-current-ver');
    this.latestVerEl = document.getElementById('update-modal-latest-ver');
    this.dateEl = document.getElementById('update-modal-date');
    this.notesEl = document.getElementById('update-modal-notes');
    this.skipCb = document.getElementById('update-modal-skip-cb');
    this.currentRelease = null;

    this.init();
  }

  init() {
    this.closeBtn?.addEventListener('click', () => this.close());
    this.dismissBtn?.addEventListener('click', () => this.close());
    this.modalEl?.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.close();
    });
    this.downloadBtn?.addEventListener('click', () => {
      if (this.currentRelease?.releaseUrl) {
        openExternalUrl(this.currentRelease.releaseUrl).catch(console.error);
      }
      this.close();
    });
    this.notesEl?.addEventListener('click', (e) => {
      const a = e.target.closest?.('a');
      if (a && a.href) {
        e.preventDefault();
        openExternalUrl(a.href).catch(console.error);
      }
    });
    this.skipCb?.addEventListener('change', () => {
      if (this.currentRelease?.latestVersion) {
        try {
          if (this.skipCb.checked) {
            localStorage.setItem('waterball_skipped_update_version', this.currentRelease.latestVersion);
          } else {
            localStorage.removeItem('waterball_skipped_update_version');
          }
        } catch {}
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modalEl?.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  show(release, { force = false } = {}) {
    if (!release || !release.hasUpdate) return;
    try {
      const skippedVersion = localStorage.getItem('waterball_skipped_update_version');
      if (!force && skippedVersion === release.latestVersion) {
        return; // User chose to skip this specific version in background prompts
      }
    } catch {}

    this.currentRelease = release;
    if (this.currentVerEl) this.currentVerEl.textContent = release.currentVersion || '';
    if (this.latestVerEl) this.latestVerEl.textContent = release.latestVersion || '';
    if (this.dateEl) this.dateEl.textContent = release.publishedAt ? `發布日期：${release.publishedAt}` : '';
    if (this.notesEl) {
      this.notesEl.innerHTML = formatReleaseNotesHtml(release.releaseNotes, release.releaseUrl);
    }
    try {
      const skippedVersion = localStorage.getItem('waterball_skipped_update_version');
      if (this.skipCb) this.skipCb.checked = (skippedVersion === release.latestVersion);
    } catch {}

    this.modalEl?.classList.remove('hidden');
  }

  close() {
    this.modalEl?.classList.add('hidden');
  }
}
