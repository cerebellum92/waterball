// Picket Report Modal Controller for Waterball
import { picketTemplateManager, renderTemplate } from './picket_report_config.js';
import { articleReader } from './article_reader.js';
import {
  aidToUrl,
  urlToAid,
  filenameToAid,
  parseAidInput,
  boardFromHeaderLine,
  detectCurrentBoard,
  validBoard,
} from './aid_helper.js';
import { writeClipboardText } from './platform.js';

const REPORTER_STORAGE_KEY = 'waterball_picket_reporter_id';

/**
 * Extracts clean PTT author ID (strips nickname in parentheses).
 * e.g. "baduser (我是暱稱)" -> "baduser"
 */
export function cleanAuthorId(rawAuthor) {
  if (!rawAuthor || typeof rawAuthor !== 'string') return '';
  const trimmed = rawAuthor.trim();
  if (!trimmed || trimmed === 'BBS 使用者') return '';
  const match = trimmed.match(/^([a-zA-Z0-9_-]{1,20})/);
  return match ? match[1] : trimmed;
}

/**
 * Parses user-selected terminal text to identify reported user ID and violation content.
 * Supports:
 * 1. PTT push comments: e.g. "推 baduser: 謾罵內容 11/09 12:34" or "baduser: 謾罵內容"
 * 2. Article author headers: e.g. "作者  baduser (壞人暱稱)"
 * 3. Exact user ID selection: e.g. "baduser" (2-20 valid username characters)
 * 4. General selected body text: returns content with author empty
 */
export function parsePicketSelection(rawSelectedText) {
  if (!rawSelectedText || typeof rawSelectedText !== 'string') {
    return { author: '', violationContent: '' };
  }
  const text = rawSelectedText.trim();
  if (!text) return { author: '', violationContent: '' };

  // 1. Article author header: "作者  baduser (暱稱)" or "作者: baduser"
  const authorMatch = text.match(/^\s*作者(?:\s*[:：]\s*|\s+)([a-zA-Z0-9_-]{2,20})/);
  if (authorMatch) {
    return {
      author: cleanAuthorId(authorMatch[1]),
      violationContent: text,
    };
  }

  // 2. PTT Push comment: "推 baduser: 內容" / "噓 baduser: 內容" / "→ baduser: 內容" / "baduser: 內容"
  const pushMatch = text.match(/^\s*(?:[推噓→]\s+)?([a-zA-Z0-9_-]{2,20})\s*[:：]\s*(.+)$/s);
  if (pushMatch) {
    return {
      author: cleanAuthorId(pushMatch[1]),
      violationContent: text,
    };
  }

  // 3. Single word username: e.g. double-clicked "baduser"
  if (/^[a-zA-Z0-9_-]{2,20}$/.test(text)) {
    return {
      author: cleanAuthorId(text),
      violationContent: '',
    };
  }

  // 4. Ordinary text content without identifiable username header
  return {
    author: '',
    violationContent: text,
  };
}

/**
 * Extracts lines of text from a TermBuf instance.
 */
export function getBufLines(buf) {
  if (!buf?.lines) return [];
  const rows = buf.rows || buf.lines.length || 24;
  const cols = buf.cols || 80;
  const rawLines = [];
  for (let r = 0; r < rows; r++) {
    const row = buf.lines[r];
    if (!row) {
      rawLines.push('');
      continue;
    }
    if (typeof buf.getRowText === 'function') {
      rawLines.push(buf.getRowText(row).trimEnd());
      continue;
    }
    let lineStr = '';
    for (let c = 0; c < cols; c++) {
      const cell = row[c];
      if (!cell || cell.isTrailByte) continue;
      lineStr += cell.ch || ' ';
    }
    rawLines.push(lineStr.trimEnd());
  }
  return rawLines;
}

/**
 * Scans 24-row terminal screen lines for PTT article metadata, AID, Web URL, and pushes.
 * Handles Page 1 headers, mid-article footers (even when header scrolled off),
 * 'Q' article info popups (with │ box borders), and article list cursor rows.
 */
export function scanLinesForPicketData(lines, fallbackBoard = '') {
  let board = validBoard(fallbackBoard) || '';
  let author = '';
  let title = '';
  let aid = '';
  let webUrl = '';
  const pushes = [];
  let isReadingArticle = false;
  let isAtArticleEnd = false;
  let isArticleList = false;
  let hasArticleHeader = false;
  let hasContinuePrompt = false;

  if (!Array.isArray(lines) || lines.length === 0) {
    return { board, author, title, aid, webUrl, pushes, isReadingArticle, isAtArticleEnd, isArticleList, hasContinuePrompt };
  }

  // 1. Check top header rows (0..4) for board, author, title
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i] || '';
    const hdrBoard = boardFromHeaderLine(line);
    if (hdrBoard) board = hdrBoard;

    if (
      (/【(?:[板版]主|徵求中)/.test(line) && /看板《[a-zA-Z0-9_-]{1,32}》/.test(line)) ||
      /編號\s+日\s*期\s+作\s*者\s+文\s*章\s*標\s*題/.test(line) ||
      /\[←\]離開\s*\[→\]閱讀/.test(line)
    ) {
      isArticleList = true;
    }

    const authorMatch = line.match(/^\s*作者(?:\s*[:：]\s*|\s+)(.+)/);
    if (authorMatch && !author) {
      const rawAuthor = authorMatch[1].trim();
      const boardSplit = rawAuthor.match(/^(.*?)\s+看板(?:\s*[:：]\s*|\s+《?)([a-zA-Z0-9_-]{1,32})/);
      if (boardSplit) {
        author = cleanAuthorId(boardSplit[1]);
        board = validBoard(boardSplit[2]) || board;
      } else {
        author = cleanAuthorId(rawAuthor);
      }
      continue;
    }

    const titleMatch = line.match(/^\s*標題(?:\s*[:：]\s*|\s+)(.+)/);
    if (titleMatch && !title) {
      const candidateTitle = titleMatch[1].trim();
      if (candidateTitle && candidateTitle !== 'BBS 文章') {
        title = candidateTitle;
      }
      continue;
    }

    const boardMatch = line.match(/^\s*看板\s*[:：]\s*([a-zA-Z0-9_-]{1,32})/);
    if (boardMatch) {
      board = validBoard(boardMatch[1]) || board;
    }
  }

  if (author && title) {
    hasArticleHeader = true;
  }

  // 2. Scan all rows for URL, AID (including Q popup box with │ borders), pushes, and footer state
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] || '';
    // Strip box drawing borders (used by PTT 'Q' info dialog: │ ... │)
    const strippedLine = rawLine.replace(/^[│┃┌┐└┘├┤┬┴┼─═\s]+|[│┃┌┐└┘├┤┬┴┼─═\s]+$/g, '').trim();

    if (/這[一]?篇文章值\s*\d+\s*Ptt幣/i.test(strippedLine)) {
      hasContinuePrompt = true;
    }

    // Detect reading status bar on bottom rows
    if (i >= lines.length - 3) {
      if (/(?:請)?按\s*(?:任意|任何|空白)\s*鍵/.test(rawLine)) {
        hasContinuePrompt = true;
      }
      const pageMatch = rawLine.match(/瀏覽\s+第\s+(\d+)(?:\/(\d+))?\s+頁/);
      if (
        pageMatch ||
        /目前顯示\s*[:：]?\s*第\s*\d+\s*[~～-]\s*\d+\s*行/.test(rawLine) ||
        /閱讀文章|主題閱讀|同作者閱讀|下面還有喔/.test(rawLine)
      ) {
        isReadingArticle = true;
        if (rawLine.includes('100%')) {
          isAtArticleEnd = true;
        } else if (pageMatch && pageMatch[2]) {
          const currP = parseInt(pageMatch[1], 10);
          const totalP = parseInt(pageMatch[2], 10);
          if (currP >= totalP) isAtArticleEnd = true;
        }
      }
      if (/文章選讀/.test(rawLine)) {
        isArticleList = true;
      }
    }

    // Match explicit "文章網址:" or "※ 文章網址:" (works in article footer and 'Q' box)
    const urlLineMatch = strippedLine.match(/(?:※\s*)?文章網址\s*[:：]\s*(https?:\/\/(?:www\.)?ptt\.cc\/bbs\/([a-zA-Z0-9_-]{1,32})\/(M\.\d{1,10}\.A(?:\.[0-9A-Fa-f]{3})?)\.html)/i);
    if (urlLineMatch) {
      webUrl = urlLineMatch[1];
      const urlBoard = validBoard(urlLineMatch[2]);
      const filename = urlLineMatch[3];
      if (urlBoard) board = urlBoard;
      const derivedAid = filenameToAid(filename);
      if (derivedAid && !aid) aid = derivedAid;
    }

    // Match explicit "文章代碼(AID): #1xxxxxxx (Board) [ptt.cc] Title" (works in 'Q' box and headers)
    const aidLineMatch = strippedLine.match(/(?:文章代碼(?:\(AID\))?|AID)\s*[:：]\s*#?([0-9a-zA-Z_-]{8})(?:\s*[（(]([a-zA-Z0-9_-]{1,32})[）)])?(?:\s*\[[^\]]+\]\s*(.+))?/i);
    if (aidLineMatch) {
      const parsedAid = parseAidInput(`#${aidLineMatch[1]}`, aidLineMatch[2] || board);
      if (parsedAid.isValid) {
        aid = parsedAid.aid;
        if (parsedAid.board) board = parsedAid.board;
        if (!webUrl && parsedAid.url) webUrl = parsedAid.url;
        if (!title && aidLineMatch[3]) {
          const cleanBoxTitle = aidLineMatch[3].replace(/[│┃].*$/, '').trim();
          if (cleanBoxTitle) title = cleanBoxTitle;
        }
      }
    }

    // Match PTT Push Comments (推 / 噓 / →)
    const pushMatch = rawLine.match(/^\s*([推噓→])\s+([a-zA-Z0-9_-]+)\s*[:：]\s*(.*)$/);
    if (pushMatch) {
      const tag = pushMatch[1];
      const pushAuthor = pushMatch[2];
      let rest = pushMatch[3].trimEnd();
      let pushIp = '';
      let pushTime = '';
      const timeMatch = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})?\s*(\d{2}\/\d{2}\s+\d{2}:\d{2})$/);
      if (timeMatch) {
        pushIp = timeMatch[1] || '';
        pushTime = timeMatch[2] || '';
        rest = rest.substring(0, timeMatch.index).trimEnd();
      }
      const ipdatetime = `${pushIp ? pushIp + ' ' : ''}${pushTime}`.trim();
      const rawPush = `${tag} ${pushAuthor}: ${rest}${ipdatetime ? ' ' + ipdatetime : ''}`.trim();
      pushes.push({
        tag,
        author: pushAuthor,
        user: pushAuthor,
        text: rest,
        content: rest,
        ip: pushIp,
        time: pushTime,
        ipdatetime,
        raw: rawPush,
        sourceRow: i,
      });
    }
  }

  if (hasArticleHeader) {
    isReadingArticle = true;
  }
  if (isReadingArticle) {
    isArticleList = false;
  }

  // 3. If on article list and cursor row ('●' or '>') is present, extract author/title fallback
  if (isArticleList && (!author || !title)) {
    for (let i = 1; i < Math.min(23, lines.length); i++) {
      const row = lines[i] || '';
      const cursorRowMatch = row.match(/^\s*[>●]\s*(?:\d+|[★*])\s+(?:[+爆MmSs=~!Xx\d\s]*?)\s*\d{1,2}\/\d{1,2}\s+([a-zA-Z0-9_-]{2,16})\s+(?:[□◆◇★轉R:]+\s*)?(.+)$/);
      if (cursorRowMatch) {
        if (!author) author = cursorRowMatch[1].trim();
        if (!title) title = cursorRowMatch[2].trim();
        break;
      }
    }
  }

  // 4. Bidirectional AID <-> WebURL completion
  if (webUrl && !aid) {
    const parsedFromUrl = urlToAid(webUrl);
    if (parsedFromUrl) {
      aid = parsedFromUrl.aid;
      if (!board) board = parsedFromUrl.board;
    }
  }
  if (aid && board && !webUrl) {
    const computedUrl = aidToUrl(board, aid);
    if (computedUrl) webUrl = computedUrl;
  }

  return {
    board,
    author,
    title,
    aid,
    webUrl,
    pushes,
    isReadingArticle,
    isAtArticleEnd,
    isArticleList,
    hasContinuePrompt,
  };
}

export const GLOBAL_UI_SCALES = [
  { id: 'standard', label: '標準' },
  { id: 'medium', label: '適中' },
  { id: 'large', label: '大字' },
  { id: 'xlarge', label: '特大' },
];

export class PicketReportModal {
  constructor(options = {}) {
    this.tabManager = options.tabManager;
    this.settingsManager = options.settingsManager || null;
    this._connectionCtrl = options.connectionCtrl;
    this.getUserId = options.getUserId || (() => '');
    this.onShowToast = options.onShowToast || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.writeClipboard = options.writeClipboard || writeClipboardText;

    this.isOpen = false;
    this.isDockedRight = false;
    this.isMinimized = false;
    this.activeTemplate = null;
    this.articleData = null;
    this.isEditingTemplates = false;
    this.lastExtractedSignature = null;
    this.isAutoFetchingAid = false;

    // Cache DOM Elements
    this.modalEl = document.getElementById('picket-modal');
    this.closeBtn = document.getElementById('picket-modal-close');
    this.fontDecBtn = document.getElementById('picket-font-dec');
    this.fontIncBtn = document.getElementById('picket-font-inc');
    this.fontValEl = document.getElementById('picket-font-val');
    this.btnDockSide = document.getElementById('picket-btn-dock-side');
    this.btnMinimize = document.getElementById('picket-btn-minimize');
    this.boardSelect = document.getElementById('picket-board-select');
    this.reporterInput = document.getElementById('picket-reporter');
    this.targetAuthorInput = document.getElementById('picket-target-author');
    this.aidInput = document.getElementById('picket-aid');
    this.titleInput = document.getElementById('picket-title');
    this.webUrlInput = document.getElementById('picket-weburl');
    this.ruleInput = document.getElementById('picket-rule-input');
    this.rulePillsContainer = document.getElementById('picket-rule-pills');
    this.violationContentInput = document.getElementById('picket-violation-content');
    this.pushesSelect = document.getElementById('picket-pushes-select');
    this.pushesRow = document.getElementById('picket-pushes-row');

    this.previewTitle = document.getElementById('picket-preview-title');
    this.previewBody = document.getElementById('picket-preview-body');

    this.btnCopyAll = document.getElementById('picket-btn-copy-all');
    this.btnCopyTitle = document.getElementById('picket-btn-copy-title');
    this.btnCopyBody = document.getElementById('picket-btn-copy-body');
    this.btnReextract = document.getElementById('picket-btn-reextract');

    this.btnOpenSplit = document.getElementById('picket-btn-open-split');
    this.btnCopyBoard = document.getElementById('picket-btn-copy-board');
    this.guideDestText = document.getElementById('picket-guide-dest-text');

    this.btnToggleTemplateEditor = document.getElementById('picket-btn-toggle-template-editor');
    this.templateEditorSection = document.getElementById('picket-template-editor-section');
    this.editTitleFormat = document.getElementById('picket-edit-title-format');
    this.editBodyFormat = document.getElementById('picket-edit-body-format');
    this.btnSaveTemplate = document.getElementById('picket-btn-save-template');
    this.btnResetTemplates = document.getElementById('picket-btn-reset-templates');

    this.initEvents();
    this.syncFontScaleUI();
  }

  get connectionCtrl() {
    return typeof this._connectionCtrl === 'function' ? this._connectionCtrl() : this._connectionCtrl;
  }

  getCurrentGlobalScaleIndex() {
    let scaleId = this.settingsManager?.settings?.toolbarScale;
    if (!scaleId && typeof document !== 'undefined' && typeof document.body?.classList?.contains === 'function') {
      for (const s of GLOBAL_UI_SCALES) {
        if (document.body.classList.contains(`toolbar-scale-${s.id}`)) {
          scaleId = s.id;
          break;
        }
      }
    }
    const idx = GLOBAL_UI_SCALES.findIndex(s => s.id === (scaleId || 'medium'));
    return idx >= 0 ? idx : 1; // default to 'medium' (適中)
  }

  setGlobalScaleByIndex(index) {
    const clampedIdx = Math.max(0, Math.min(GLOBAL_UI_SCALES.length - 1, index));
    const scale = GLOBAL_UI_SCALES[clampedIdx];
    if (typeof document !== 'undefined' && document.body?.classList) {
      GLOBAL_UI_SCALES.forEach(s => document.body.classList.remove?.(`toolbar-scale-${s.id}`));
      document.body.classList.add?.(`toolbar-scale-${scale.id}`);
      const settingSelect = document.getElementById?.('setting-toolbar-scale');
      if (settingSelect) settingSelect.value = scale.id;
    }
    this.settingsManager?.saveSettings?.({ toolbarScale: scale.id });
    this.syncFontScaleUI(clampedIdx);
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new Event('toolbar-scale-changed'));
    }
    setTimeout(() => {
      this.tabManager?.tabs?.forEach((t) => t.view?.resize?.());
    }, 60);
    this.onShowToast(`🔤 全域介面與視窗字體已調整為「${scale.label}」`);
  }

  syncFontScaleUI(forcedIdx = null) {
    const idx = typeof forcedIdx === 'number' ? forcedIdx : this.getCurrentGlobalScaleIndex();
    const scale = GLOBAL_UI_SCALES[idx] || GLOBAL_UI_SCALES[1];
    if (this.fontValEl) {
      this.fontValEl.textContent = scale.label;
    }
    if (this.fontDecBtn) {
      this.fontDecBtn.disabled = idx <= 0;
      if (this.fontDecBtn.style) this.fontDecBtn.style.opacity = idx <= 0 ? '0.4' : '1';
    }
    if (this.fontIncBtn) {
      this.fontIncBtn.disabled = idx >= GLOBAL_UI_SCALES.length - 1;
      if (this.fontIncBtn.style) this.fontIncBtn.style.opacity = idx >= GLOBAL_UI_SCALES.length - 1 ? '0.4' : '1';
    }
  }

  initEvents() {
    this.closeBtn?.addEventListener('click', () => this.close());

    // Global UI font scale adjustment (unified with app toolbarScale)
    this.fontDecBtn?.addEventListener('click', () => {
      const idx = this.getCurrentGlobalScaleIndex();
      if (idx > 0) this.setGlobalScaleByIndex(idx - 1);
    });

    this.fontIncBtn?.addEventListener('click', () => {
      const idx = this.getCurrentGlobalScaleIndex();
      if (idx < GLOBAL_UI_SCALES.length - 1) this.setGlobalScaleByIndex(idx + 1);
    });

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('toolbar-scale-changed', () => this.syncFontScaleUI());
    }

    // Toggle left/right docking so user can uncover either pane
    this.btnDockSide?.addEventListener('click', () => {
      this.isDockedRight = !this.isDockedRight;
      this.modalEl?.classList.toggle('dock-right', this.isDockedRight);
      if (this.btnDockSide) {
        this.btnDockSide.textContent = this.isDockedRight ? '⇄ 移至左側' : '⇄ 移至右側';
      }
    });

    // Toggle minimize/expand
    this.btnMinimize?.addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      this.modalEl?.classList.toggle('minimized', this.isMinimized);
      if (this.btnMinimize) {
        this.btnMinimize.textContent = this.isMinimized ? '▢ 展開' : '▂ 縮小';
      }
    });

    // Board change
    this.boardSelect?.addEventListener('change', () => {
      const selectedKey = this.boardSelect.value;
      this.activeTemplate = picketTemplateManager.getTemplate(selectedKey);
      this.renderRulePills();
      this.updateGuideUI();
      this.updatePreview();
      this.syncTemplateEditor();
    });

    // Bidirectional live sync when user edits AID or WebURL manually
    this.aidInput?.addEventListener('input', () => {
      const rawAid = this.aidInput.value.trim();
      const board = this.activeTemplate?.board || this.articleData?.board || '';
      const parsed = parseAidInput(rawAid, board);
      if (parsed.isValid && parsed.url && this.webUrlInput) {
        this.webUrlInput.value = parsed.url;
      }
    });

    this.webUrlInput?.addEventListener('input', () => {
      const rawUrl = this.webUrlInput.value.trim();
      const parsed = urlToAid(rawUrl);
      if (parsed && this.aidInput) {
        this.aidInput.value = parsed.aid;
      }
    });

    // Live inputs update preview
    const inputs = [
      this.reporterInput,
      this.targetAuthorInput,
      this.aidInput,
      this.titleInput,
      this.webUrlInput,
      this.ruleInput,
      this.violationContentInput,
    ];
    inputs.forEach(input => {
      input?.addEventListener('input', () => {
        if (input === this.reporterInput && this.reporterInput?.value?.trim()) {
          try {
            localStorage.setItem(REPORTER_STORAGE_KEY, this.reporterInput.value.trim());
          } catch {}
        }
        this.updatePreview();
      });
    });

    // Push comment select
    this.pushesSelect?.addEventListener('change', () => {
      const selectedIdx = parseInt(this.pushesSelect.value, 10);
      if (!isNaN(selectedIdx) && this.articleData?.pushes?.[selectedIdx]) {
        const p = this.articleData.pushes[selectedIdx];
        const pushAuthor = p.author || p.user || '';
        const pushText = p.text ?? p.content ?? '';
        const pushTime = p.ipdatetime || `${p.ip ? p.ip + ' ' : ''}${p.time || ''}`.trim();
        if (pushAuthor && this.targetAuthorInput) {
          this.targetAuthorInput.value = pushAuthor;
        }
        if (this.violationContentInput) {
          const raw = p.raw || `${p.tag} ${pushAuthor}: ${pushText}${pushTime ? ' ' + pushTime : ''}`.trim();
          this.violationContentInput.value = raw;
        }
        this.updatePreview();
      }
    });

    // Copy Buttons
    this.btnCopyAll?.addEventListener('click', () => this.copyToClipboard('all'));
    this.btnCopyTitle?.addEventListener('click', () => this.copyToClipboard('title'));
    this.btnCopyBody?.addEventListener('click', () => this.copyToClipboard('body'));

    // Re-extract current screen button
    this.btnReextract?.addEventListener('click', async () => {
      await this.populateFromScreen(true);
      this.onShowToast('🔄 已重新從畫面擷取文章代碼、網址與推文資訊');
    });

    // Guide helper: Open right split pane
    this.btnOpenSplit?.addEventListener('click', () => {
      if (!this.tabManager) return;
      if (!this.tabManager.isSplit) {
        this.tabManager.toggleSplitView?.();
        this.updateGuideUI();
        this.focusRightPaneIfSplit();
        this.onShowToast('✅ 已開啟右側並排視窗！焦點已移至右側，可直接連線並前往檢舉板');
      } else {
        this.focusRightPaneIfSplit();
        this.onShowToast('✅ 已將鍵盤焦點切換至右側並排視窗');
      }
    });

    // Guide helper: Copy picket board name
    this.btnCopyBoard?.addEventListener('click', async () => {
      const picketBoard = this.activeTemplate?.picketBoard;
      if (!picketBoard) return;
      try {
        await this.writeClipboard(picketBoard);
        this.focusRightPaneIfSplit();
        this.onShowToast(`✅ 已複製檢舉板名「${picketBoard}」！可在右側視窗按 s 貼上跳轉`);
      } catch (e) {
        this.onShowToast(`❌ 複製失敗：${e.message || e}`);
      }
    });

    // Template Editor
    this.btnToggleTemplateEditor?.addEventListener('click', () => {
      this.isEditingTemplates = !this.isEditingTemplates;
      this.templateEditorSection?.classList.toggle('hidden', !this.isEditingTemplates);
      if (this.isEditingTemplates) {
        this.syncTemplateEditor();
      }
    });

    this.btnSaveTemplate?.addEventListener('click', () => {
      if (!this.activeTemplate) return;
      this.activeTemplate.titleFormat = this.editTitleFormat?.value || '';
      this.activeTemplate.bodyFormat = this.editBodyFormat?.value || '';
      picketTemplateManager.saveTemplate(this.activeTemplate.key, this.activeTemplate);
      this.updatePreview();
      this.onShowToast(`已儲存「${this.activeTemplate.name}」自訂範本！`);
    });

    this.btnResetTemplates?.addEventListener('click', () => {
      if (confirm('確定要將所有檢舉範本恢復為系統預設值嗎？')) {
        picketTemplateManager.resetToDefaults();
        this.populateBoardSelect();
        this.activeTemplate = picketTemplateManager.getTemplate(this.boardSelect?.value || 'general');
        this.renderRulePills();
        this.updateGuideUI();
        this.syncTemplateEditor();
        this.updatePreview();
        this.onShowToast('檢舉範本已全數恢復預設值！');
      }
    });

    // Placeholder tag helper buttons inside template editor
    this.templateEditorSection?.querySelectorAll('.picket-tag-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tag = e.target.dataset.tag;
        if (!tag || !this.editBodyFormat) return;
        const start = this.editBodyFormat.selectionStart || 0;
        const end = this.editBodyFormat.selectionEnd || 0;
        const val = this.editBodyFormat.value;
        this.editBodyFormat.value = val.substring(0, start) + tag + val.substring(end);
        this.editBodyFormat.focus();
        this.editBodyFormat.selectionStart = this.editBodyFormat.selectionEnd = start + tag.length;
      });
    });
  }

  /**
   * Focuses the secondary (right) split pane if split view is active,
   * so the user can immediately type/paste into the right terminal pane.
   */
  focusRightPaneIfSplit() {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur?.();
    }
    if (this.tabManager?.isSplit && this.tabManager.splitTabId) {
      this.tabManager.focusSplitPane?.(this.tabManager.splitTabId);
    }
    const imeInput = document.getElementById('ime-input');
    imeInput?.focus?.();
  }

  populateBoardSelect(selectedKey = null) {
    if (!this.boardSelect) return;
    this.boardSelect.innerHTML = '';
    const templates = picketTemplateManager.getAll();

    for (const t of templates) {
      const opt = document.createElement('option');
      opt.value = t.key;
      opt.textContent = t.name || t.board;
      if (selectedKey && t.key.toLowerCase() === selectedKey.toLowerCase()) {
        opt.selected = true;
      }
      this.boardSelect.appendChild(opt);
    }
  }

  renderRulePills() {
    if (!this.rulePillsContainer) return;
    this.rulePillsContainer.innerHTML = '';

    const rules = this.activeTemplate?.suggestedRules || [];
    for (const r of rules) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'picket-rule-pill';
      pill.textContent = r;
      pill.addEventListener('click', () => {
        if (this.ruleInput) {
          this.ruleInput.value = r;
          this.updatePreview();
        }
      });
      this.rulePillsContainer.appendChild(pill);
    }
  }

  updateGuideUI() {
    const isSplit = Boolean(this.tabManager?.isSplit);
    if (this.btnOpenSplit) {
      this.btnOpenSplit.textContent = isSplit ? '✅ 已開啟右側並排視窗' : '◫ 開啟右側並排視窗';
    }

    const picketBoard = this.activeTemplate?.picketBoard || '';
    if (this.guideDestText) {
      if (picketBoard) {
        this.guideDestText.innerHTML = `按 <kbd>s</kbd> 進入檢舉專板 <strong id="picket-guide-board-code" style="color: var(--text-primary); font-family: monospace;">${picketBoard}</strong>`;
      } else {
        this.guideDestText.textContent = '前往該看板對應之檢舉專板（或直接寄信給該板板主）';
      }
    }
    if (this.btnCopyBoard) {
      this.btnCopyBoard.classList.toggle('hidden', !picketBoard);
    }
  }

  syncTemplateEditor() {
    if (!this.activeTemplate) return;
    if (this.editTitleFormat) this.editTitleFormat.value = this.activeTemplate.titleFormat || '';
    if (this.editBodyFormat) this.editBodyFormat.value = this.activeTemplate.bodyFormat || '';
  }

  resolveDefaultReporter() {
    const fromSession = this.getUserId?.();
    if (fromSession) return fromSession;
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(REPORTER_STORAGE_KEY) : '';
      if (saved) return saved;
    } catch {}
    return '';
  }

  getValues() {
    return {
      reporter: this.reporterInput?.value?.trim() || this.resolveDefaultReporter() || '（請填寫您的ID）',
      targetAuthor: this.targetAuthorInput?.value?.trim() || '（請填寫被檢舉人ID）',
      aid: this.aidInput?.value?.trim() || '（文章代碼）',
      board: this.activeTemplate?.board || this.articleData?.board || '（看板）',
      picketBoard: this.activeTemplate?.picketBoard || '',
      title: this.titleInput?.value?.trim() || '（文章標題）',
      webUrl: this.webUrlInput?.value?.trim() || '（網頁網址）',
      ruleClause: this.ruleInput?.value?.trim() || '（違規條款）',
      violationContent: this.violationContentInput?.value?.trim() || '（違規事證內容）',
    };
  }

  updatePreview() {
    if (!this.activeTemplate) return;
    const vals = this.getValues();
    const renderedTitle = renderTemplate(this.activeTemplate.titleFormat, vals);
    const renderedBody = renderTemplate(this.activeTemplate.bodyFormat, vals);

    if (this.previewTitle) this.previewTitle.value = renderedTitle;
    if (this.previewBody) this.previewBody.value = renderedBody;
  }

  async copyToClipboard(mode = 'all') {
    const title = this.previewTitle?.value || '';
    const body = this.previewBody?.value || '';
    let toCopy = '';

    if (mode === 'title') {
      toCopy = title;
    } else if (mode === 'body') {
      toCopy = body;
    } else {
      toCopy = `標題：${title}\n\n${body}`;
    }

    try {
      await this.writeClipboard(toCopy);
      this.focusRightPaneIfSplit();
      if (mode === 'title') {
        this.onShowToast('✅ 已複製「檢舉標題」！焦點已移至右側視窗，請直接貼上標題');
      } else if (mode === 'body') {
        this.onShowToast('✅ 已複製「檢舉內文」！焦點已移至右側視窗，請直接貼入內文區');
      } else {
        this.onShowToast('✅ 已複製完整檢舉標題與內文到剪貼簿！');
      }
    } catch (e) {
      this.onShowToast(`❌ 複製失敗：${e.message || e}`);
    }
  }

  /**
   * Attaches a passive listener to tab.buf so as the user scrolls through an article
   * (Page 1 header -> Page 2 footer URL -> Page 3 pushes), metadata is cached on tab._picketContext.
   */
  ensureTabTracker(tab) {
    if (!tab?.buf || tab._picketTrackerAttached) return;
    tab._picketTrackerAttached = true;
    tab._picketContext = tab._picketContext || {
      board: '',
      author: '',
      title: '',
      aid: '',
      webUrl: '',
      pushes: [],
    };
  }

  updateTabContextFromScreen(tab) {
    if (!tab?.buf) return null;
    this.ensureTabTracker(tab);
    const ctx = tab._picketContext;
    const lines = getBufLines(tab.buf);
    const scanned = scanLinesForPicketData(lines, ctx.board || detectCurrentBoard(tab.buf) || '');

    // Detect if the user moved to a different article (ignoring truncated Q-box or list title prefixes)
    const titlesIncompatible = Boolean(
      scanned.title &&
      ctx.title &&
      scanned.title !== ctx.title &&
      !ctx.title.startsWith(scanned.title) &&
      !scanned.title.startsWith(ctx.title)
    );
    const aidsIncompatible = Boolean(
      scanned.aid && ctx.aid && scanned.aid !== ctx.aid
    );
    const isNewHeader = !this.isAutoFetchingAid && (titlesIncompatible || aidsIncompatible);

    if (isNewHeader) {
      ctx.board = scanned.board || ctx.board;
      ctx.author = scanned.author || '';
      ctx.title = scanned.title || '';
      ctx.aid = scanned.aid || '';
      ctx.webUrl = scanned.webUrl || '';
      ctx.pushes = [...scanned.pushes];
    } else {
      if (scanned.board) ctx.board = scanned.board;
      if (scanned.author) ctx.author = scanned.author;
      if (scanned.title) {
        if (!ctx.title || !ctx.title.startsWith(scanned.title) || scanned.title.length >= ctx.title.length) {
          ctx.title = scanned.title;
        }
      }
      if (scanned.aid) ctx.aid = scanned.aid;
      if (scanned.webUrl) ctx.webUrl = scanned.webUrl;

      // Merge pushes without duplicating identical lines
      const existingRaw = new Set(ctx.pushes.map(p => p.raw));
      for (const p of scanned.pushes) {
        if (!existingRaw.has(p.raw)) {
          ctx.pushes.push(p);
          existingRaw.add(p.raw);
        }
      }
    }

    // Also cross-fill from articleReader.currentArticle if user opened 好讀版 on the same article
    const readerArt = articleReader?.currentArticle;
    if (readerArt) {
      const sameTitle = !ctx.title || (readerArt.title && readerArt.title === ctx.title);
      const sameBoard = !ctx.board || (readerArt.board && readerArt.board.toLowerCase() === ctx.board.toLowerCase());
      if (sameTitle && sameBoard) {
        if (!ctx.aid && readerArt.aid) ctx.aid = readerArt.aid;
        if (!ctx.webUrl && readerArt.webUrl) ctx.webUrl = readerArt.webUrl;
        if (!ctx.title && readerArt.title && readerArt.title !== 'BBS 文章') ctx.title = readerArt.title;
        if (!ctx.author && readerArt.author && readerArt.author !== 'BBS 使用者') {
          ctx.author = cleanAuthorId(readerArt.author);
        }
      }
    }

    // Bidirectional AID <-> WebURL completion on merged context
    if (ctx.webUrl && !ctx.aid) {
      const fromUrl = urlToAid(ctx.webUrl);
      if (fromUrl) {
        ctx.aid = fromUrl.aid;
        if (!ctx.board) ctx.board = fromUrl.board;
      }
    }
    if (ctx.aid && ctx.board && !ctx.webUrl) {
      const url = aidToUrl(ctx.board, ctx.aid);
      if (url) ctx.webUrl = url;
    }

    return {
      board: ctx.board,
      author: ctx.author,
      title: ctx.title,
      aid: ctx.aid,
      webUrl: ctx.webUrl,
      pushes: scanned.pushes.length > 0 ? scanned.pushes : ctx.pushes,
      allPushes: ctx.pushes,
      isReadingArticle: scanned.isReadingArticle,
      isAtArticleEnd: scanned.isAtArticleEnd,
      isArticleList: scanned.isArticleList,
      hasContinuePrompt: scanned.hasContinuePrompt,
      sourceTab: tab,
    };
  }

  extractArticleFromTab(tab) {
    if (!tab?.buf) return null;
    try {
      return this.updateTabContextFromScreen(tab);
    } catch (e) {
      console.warn('Failed to parse article for picket modal:', e);
      return null;
    }
  }

  /**
   * Resolves the article tab to extract from.
   * In Split View, prefers the primary (left) tab or whichever tab has an article/list open.
   */
  resolveSourceTab(preferredTab = null) {
    if (preferredTab?.buf) return preferredTab;
    if (this.tabManager?.isSplit) {
      const leftTab = this.tabManager.getPrimaryTab?.();
      const rightTab = this.tabManager.getSecondaryTab?.();
      const leftData = this.extractArticleFromTab(leftTab);
      if (leftData && (leftData.aid || leftData.title || leftData.pushes?.length > 0 || leftData.isReadingArticle || leftData.isArticleList)) {
        return leftTab;
      }
      const rightData = this.extractArticleFromTab(rightTab);
      if (rightData && (rightData.aid || rightData.title || rightData.pushes?.length > 0 || rightData.isReadingArticle || rightData.isArticleList)) {
        return rightTab;
      }
    }
    return this.tabManager?.getActiveTab?.() || null;
  }

  extractArticleFromActiveTab(preferredTab = null) {
    const sourceTab = this.resolveSourceTab(preferredTab);
    return this.extractArticleFromTab(sourceTab);
  }

  waitForBufferUpdate(tab, timeoutMs = 360) {
    return new Promise((resolve) => {
      if (!tab?.buf) {
        resolve();
        return;
      }
      let resolved = false;
      const orig = tab.buf.onUpdate;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          tab.buf.onUpdate = orig;
          resolve();
        }
      }, timeoutMs);

      tab.buf.onUpdate = () => {
        if (orig) orig();
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          tab.buf.onUpdate = orig;
          setTimeout(resolve, 40);
        }
      };
    });
  }

  /**
   * Automatically retrieves missing AID and Web URL when the user opens the Picket Report helper:
   * - On Article List (文章選讀): sends 'Q' (Shift+Q) to open PTT's article info popup, extracts AID/URL, then sends ' ' to close it.
   * - Inside an Article (瀏覽 第 x/y 頁):
   *   1. If not at the end of the article, checks the next 1-3 pages (' ') for the "※ 文章網址:" footer.
   *   2. If at the end of pushes (100%) or if "※ 文章網址:" already scrolled off / article is long,
   *      performs a fast 'q' -> 'Q' -> ' ' -> '\r' (and '$' if originally at 100%) lookup to grab the exact AID/URL/Board/Title.
   */
  async autoFetchMissingAidIfNeeded(extracted) {
    if (!extracted || (extracted.aid && extracted.webUrl)) return extracted;
    if (this.isAutoFetchingAid) return extracted;

    const tab = extracted.sourceTab;
    const conn = this.connectionCtrl;
    if (!tab?.isConnected || !conn?.sendDataToTabAndWait || !conn?.getConnectionSession) {
      return extracted;
    }

    const bbsState = tab.view?.getBbsState?.() || '';
    const isReading = Boolean(extracted.isReadingArticle || bbsState === 'reading');
    const isList = Boolean(!isReading && (extracted.isArticleList || bbsState === 'article-list'));
    if (!isReading && !isList) {
      return extracted;
    }

    const origAidPlaceholder = this.aidInput?.placeholder || '';
    const origUrlPlaceholder = this.webUrlInput?.placeholder || '';
    if (this.aidInput && !this.aidInput.value.trim()) {
      this.aidInput.placeholder = '⏳ 正在自動從 PTT 擷取文章代碼...';
    }
    if (this.webUrlInput && !this.webUrlInput.value.trim()) {
      this.webUrlInput.placeholder = '⏳ 正在自動從 PTT 擷取文章網址...';
    }

    this.isAutoFetchingAid = true;
    try {
      const session = await conn.getConnectionSession(tab.id);
      const send = (data) => conn.sendDataToTabAndWait(tab.id, data, session);

      // Case 1: User is on the Article List (文章選讀) -> press 'Q' to query AID & URL, then ' ' to dismiss
      if (isList) {
        const waitQ = this.waitForBufferUpdate(tab, 420);
        await send('Q');
        await waitQ;
        extracted = this.updateTabContextFromScreen(tab);

        if (extracted?.hasContinuePrompt) {
          const waitDismiss = this.waitForBufferUpdate(tab, 320);
          await send(' ');
          await waitDismiss;
          extracted = this.updateTabContextFromScreen(tab);
        }
        return extracted;
      }

      // Case 2: User is inside the article reader (瀏覽 第 ... 頁)
      const wasAtEnd = Boolean(extracted.isAtArticleEnd);

      // Step 2a: If not at end of article, try paging down up to 3 times to catch nearby "※ 文章網址:" footer
      if (!wasAtEnd) {
        let steps = 0;
        let lastHash = '';
        while (steps < 3) {
          steps++;
          const lines = getBufLines(tab.buf);
          const scan = scanLinesForPicketData(lines, extracted.board);
          if (!scan.isReadingArticle || scan.isAtArticleEnd) break;

          const curHash = lines.slice(0, 23).join('\n');
          if (curHash === lastHash) break;
          lastHash = curHash;

          const waitPage = this.waitForBufferUpdate(tab, 340);
          await send(' ');
          await waitPage;

          extracted = this.updateTabContextFromScreen(tab);
          if (extracted.aid && extracted.webUrl) {
            return extracted;
          }
        }
      }

      // Step 2b: Still missing AID/URL (e.g. user was at pushes after footer, or article is long).
      // Exit to article list ('q'), query 'Q' popup for authoritative AID + WebURL + Board + Title, then re-enter article ('\r').
      if (!extracted.aid || !extracted.webUrl) {
        const waitExit = this.waitForBufferUpdate(tab, 380);
        await send('q');
        await waitExit;
        extracted = this.updateTabContextFromScreen(tab);

        const nowOnList = Boolean(
          extracted?.isArticleList ||
          tab.view?.getBbsState?.() === 'article-list'
        );

        if (nowOnList) {
          const waitQ = this.waitForBufferUpdate(tab, 420);
          await send('Q');
          await waitQ;
          extracted = this.updateTabContextFromScreen(tab);

          // Dismiss 'Q' popup
          const waitDismiss = this.waitForBufferUpdate(tab, 320);
          await send(' ');
          await waitDismiss;

          // Re-enter the article so the user stays in the article view
          const waitReenter = this.waitForBufferUpdate(tab, 380);
          await send('\r');
          await waitReenter;

          if (wasAtEnd) {
            const waitEnd = this.waitForBufferUpdate(tab, 350);
            await send('$');
            await waitEnd;
          }
          extracted = this.updateTabContextFromScreen(tab);
          if (extracted.aid && extracted.webUrl) {
            return extracted;
          }
        }

        // Step 2c: Fallback for environments where 'q' did not transition to list (e.g. simple paging mocks)
        if (!extracted.aid || !extracted.webUrl) {
          const waitTop = this.waitForBufferUpdate(tab, 350);
          await send('\x1b[1~');
          await waitTop;
          extracted = this.updateTabContextFromScreen(tab);
          if (extracted.aid && extracted.webUrl) return extracted;

          let steps = 0;
          let lastHash = '';
          while (steps < 15) {
            steps++;
            const lines = getBufLines(tab.buf);
            const scan = scanLinesForPicketData(lines, extracted.board);
            if (!scan.isReadingArticle || scan.isAtArticleEnd) break;
            const curHash = lines.slice(0, 23).join('\n');
            if (curHash === lastHash) break;
            lastHash = curHash;

            const waitPage = this.waitForBufferUpdate(tab, 320);
            await send(' ');
            await waitPage;
            extracted = this.updateTabContextFromScreen(tab);
            if (extracted.aid && extracted.webUrl) break;
          }
        }
      }
    } catch (e) {
      console.warn('Auto-fetch AID stopped:', e);
    } finally {
      this.isAutoFetchingAid = false;
      if (this.aidInput && origAidPlaceholder) this.aidInput.placeholder = origAidPlaceholder;
      if (this.webUrlInput && origUrlPlaceholder) this.webUrlInput.placeholder = origUrlPlaceholder;
    }

    return extracted;
  }

  populatePushesDropdown(pushes = []) {
    if (!this.pushesSelect || !this.pushesRow) return;
    this.pushesSelect.innerHTML = '<option value="">-- 點此直接勾選違規推文 --</option>';
    if (pushes.length > 0) {
      this.pushesRow.classList.remove('hidden');
      pushes.forEach((p, idx) => {
        const pushAuthor = p.author || p.user || '';
        const pushText = String(p.text ?? p.content ?? '');
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${p.tag} ${pushAuthor}: ${pushText.substring(0, 36)}`;
        this.pushesSelect.appendChild(opt);
      });
    } else {
      this.pushesRow.classList.add('hidden');
    }
  }

  async populateFromScreen(forceReset = false, contextOptions = {}) {
    const preferredTab = contextOptions.tab || null;
    let extracted = this.extractArticleFromActiveTab(preferredTab);

    if (this.reporterInput && !this.reporterInput.value.trim()) {
      this.reporterInput.value = this.resolveDefaultReporter();
    }

    const newSig = extracted
      ? `${extracted.board || ''}|${extracted.title || ''}|${extracted.author || ''}`
      : '';

    const hasExistingDraft = Boolean(
      this.lastExtractedSignature &&
      (this.targetAuthorInput?.value || this.aidInput?.value || this.violationContentInput?.value || this.ruleInput?.value)
    );

    const isSameOrEmptyScreen = !forceReset && hasExistingDraft && (
      newSig === this.lastExtractedSignature ||
      (!extracted?.aid && !extracted?.title && (!extracted?.pushes || extracted.pushes.length === 0))
    );

    if (!isSameOrEmptyScreen) {
      this.articleData = extracted;
      this.lastExtractedSignature = newSig || 'draft';

      const matchedBoard = this.articleData?.board || '';
      const template = picketTemplateManager.getTemplateForBoard(matchedBoard);
      this.activeTemplate = template;

      this.populateBoardSelect(template.key);
      this.renderRulePills();

      // 被檢舉人 ID 預設保持為空，絕不預設帶入原 PO！避免檢舉推文時遺漏更改
      if (this.targetAuthorInput) this.targetAuthorInput.value = '';
      if (this.aidInput) this.aidInput.value = this.articleData?.aid || '';
      if (this.titleInput) this.titleInput.value = this.articleData?.title || '';
      if (this.webUrlInput) this.webUrlInput.value = this.articleData?.webUrl || '';
      if (this.ruleInput) this.ruleInput.value = '';
      if (this.violationContentInput) this.violationContentInput.value = '';
    } else if (extracted) {
      // Even when preserving draft, fill in any newly discovered AID / WebURL / Title
      this.articleData = extracted;
      if (this.aidInput && !this.aidInput.value.trim() && extracted.aid) {
        this.aidInput.value = extracted.aid;
      }
      if (this.webUrlInput && !this.webUrlInput.value.trim() && extracted.webUrl) {
        this.webUrlInput.value = extracted.webUrl;
      }
      if (this.titleInput && !this.titleInput.value.trim() && extracted.title) {
        this.titleInput.value = extracted.title;
      }
    }

    // 優先檢查是否有反白選取文字（無論是右鍵選單帶入，或於終端機選取後直接點按檢舉按鈕）
    const ctxInfo = contextOptions.info || {};
    let selectedText = ctxInfo.selectedText || '';
    if (!selectedText) {
      const activeTab = this.resolveSourceTab(contextOptions.tab);
      if (activeTab?.view?.getSelectionText) {
        selectedText = activeTab.view.getSelectionText()?.trim() || '';
      }
    }

    if (selectedText) {
      const parsedSel = parsePicketSelection(selectedText);
      if (parsedSel.author && this.targetAuthorInput) {
        this.targetAuthorInput.value = parsedSel.author;
      }
      if (parsedSel.violationContent && this.violationContentInput && !this.violationContentInput.value.trim()) {
        this.violationContentInput.value = parsedSel.violationContent;
      }
    } else if (ctxInfo) {
      // 若無反白選取，但右鍵精確點擊在某列推文上
      if (typeof ctxInfo.gridY === 'number' && extracted?.pushes?.length > 0) {
        const clickedPushIdx = extracted.pushes.findIndex(p => p.sourceRow === ctxInfo.gridY);
        if (clickedPushIdx !== -1) {
          const clickedPush = extracted.pushes[clickedPushIdx];
          if (this.targetAuthorInput && clickedPush.author) {
            this.targetAuthorInput.value = clickedPush.author;
          }
          if (this.violationContentInput && clickedPush.raw && !this.violationContentInput.value.trim()) {
            this.violationContentInput.value = clickedPush.raw;
          }
        }
      }
    }

    this.updateGuideUI();
    this.updatePreview();

    // If AID or WebURL is still missing (either on Article List or inside an Article), auto-fetch from PTT
    if (extracted && (!extracted.aid || !extracted.webUrl)) {
      const updated = await this.autoFetchMissingAidIfNeeded(extracted);
      if (updated && (updated.aid || updated.webUrl || updated.title || updated.author)) {
        this.articleData = updated;
        if (updated.board && (!this.activeTemplate || this.activeTemplate.key === 'general')) {
          const template = picketTemplateManager.getTemplateForBoard(updated.board);
          this.activeTemplate = template;
          this.populateBoardSelect(template.key);
          this.renderRulePills();
          this.updateGuideUI();
        }
        if (this.aidInput && (!this.aidInput.value.trim() || forceReset) && updated.aid) {
          this.aidInput.value = updated.aid;
        }
        if (this.webUrlInput && (!this.webUrlInput.value.trim() || forceReset) && updated.webUrl) {
          this.webUrlInput.value = updated.webUrl;
        }
        if (this.titleInput && (!this.titleInput.value.trim() || forceReset) && updated.title) {
          this.titleInput.value = updated.title;
        }
        this.updatePreview();
      }
    }
  }

  handleTabData(tab) {
    if (!tab?.buf) return;
    const updated = this.updateTabContextFromScreen(tab);
    if (!this.isOpen || !updated) return;

    // If the panel is open and missing AID/WebURL/Title, fill them live as the user scrolls or presses Q
    let changed = false;
    if (this.aidInput && !this.aidInput.value.trim() && updated.aid) {
      this.aidInput.value = updated.aid;
      changed = true;
    }
    if (this.webUrlInput && !this.webUrlInput.value.trim() && updated.webUrl) {
      this.webUrlInput.value = updated.webUrl;
      changed = true;
    }
    if (this.titleInput && !this.titleInput.value.trim() && updated.title) {
      this.titleInput.value = updated.title;
      changed = true;
    }
    // 注意：不自動填寫 targetAuthorInput，維持使用者輸入或反白選取結果！
    if (changed) {
      this.updatePreview();
    }
  }

  open(contextOptions = {}) {
    this.isOpen = true;
    this.isMinimized = false;
    this.modalEl?.classList.remove('minimized');
    if (this.btnMinimize) this.btnMinimize.textContent = '▂ 縮小';
    this.syncFontScaleUI();
    this.modalEl?.classList.remove('hidden');
    this.onStateChange();

    if (!contextOptions.info?.selectedText) {
      const activeTab = this.resolveSourceTab(contextOptions.tab);
      const sel = activeTab?.view?.getSelectionText?.()?.trim();
      if (sel) {
        contextOptions = {
          ...contextOptions,
          info: {
            ...(contextOptions.info || {}),
            selectedText: sel,
          },
        };
      }
    }

    void this.populateFromScreen(false, contextOptions);
  }

  close() {
    this.isOpen = false;
    this.modalEl?.classList.add('hidden');
    this.tabManager?.getActiveTab?.()?.term?.focus?.();
    this.onStateChange();
  }
}
