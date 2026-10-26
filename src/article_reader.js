import { isImageUrl, normalizeImageUrl, getProxiedImageUrl } from './image_preview.js';
import { blacklistManager } from './blacklist.js';
import { writeClipboardText } from './platform.js';
import { userTagsManager, TAG_COLORS } from './user_tags.js';
import { repairBrokenUrl, bbsColumns } from './url_repair.js';
import { extractAidsFromLine, boardFromHeaderLine } from './aid_helper.js';

export class ArticleParser {
  static parseFromBuf(buf) {
    const rawLines = [];
    for (let r = 0; r < buf.rows; r++) {
      let lineStr = '';
      for (let c = 0; c < buf.cols; c++) {
        const cell = buf.lines[r][c];
        if (!cell) continue;
        if (cell.isTrailByte) continue;
        lineStr += cell.ch || ' ';
      }
      rawLines.push(lineStr.trimEnd());
    }

    return this.parseLines(rawLines, { columns: buf.cols });
  }

  static parseLines(lines, { columns = 80 } = {}) {
    let author = '';
    let title = '';
    let time = '';
    let board = '';

    const bodyBlocks = [];
    const pushList = [];
    let pushStats = { push: 0, boo: 0, arrow: 0 };

    let inHeader = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect BBS Article Headers (作者 / 標題 / 時間 / 看板)
      if (inHeader) {
        if (i < 5) board = boardFromHeaderLine(line) || board;
        if (/^作者(?:\s*[:：]\s*|\s+)(.+)/.test(line)) {
          author = line.match(/^作者(?:\s*[:：]\s*|\s+)(.+)/)[1].trim();
          continue;
        }
        if (/^標題(?:\s*[:：]\s*|\s+)(.+)/.test(line)) {
          title = line.match(/^標題(?:\s*[:：]\s*|\s+)(.+)/)[1].trim();
          continue;
        }
        if (/^時間(?:\s*[:：]\s*|\s+)(.+)/.test(line)) {
          time = line.match(/^時間(?:\s*[:：]\s*|\s+)(.+)/)[1].trim();
          continue;
        }
        if (/^看板\s*[:：]\s*(.+)/.test(line)) {
          board = line.match(/^看板\s*[:：]\s*(.+)/)[1].trim();
          continue;
        }
        // If empty line or separator line after header, exit header mode
        if (line.startsWith('───────────────────') || line.startsWith('═══════════════════') || line === '') {
          inHeader = false;
          continue;
        }
      }

      // Ignore bottom navigation bar lines (e.g. "瀏覽 第 x/y 頁 ( 100%)  目前顯示: 第 01~24 行 (y)回應")
      if (/瀏覽\s+第\s+\d+\/\d+\s+頁/.test(line) || /目前顯示\s*[:：]/.test(line) || /【看板列表】/.test(line)) {
        continue;
      }

      // Detect PTT Push Comments (推 / 噓 / →)
      // Format: "推 user: comment message                 08/15 22:30"
      // or "噓 user: comment message                 08/15 22:30"
      // or "→ user: comment message                 08/15 22:30"
      const pushMatch = line.match(/^([推噓→])\s+([a-zA-Z0-9_-]+)\s*[:：]\s*(.*)$/);
      if (pushMatch) {
        const tag = pushMatch[1];
        const user = pushMatch[2];
        let rest = pushMatch[3].trimEnd();

        // Extract trailing IP/Timestamp if present
        let pushTime = '';
        let pushIp = '';
        const timeMatch = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})?\s*(\d{2}\/\d{2}\s+\d{2}:\d{2})$/);
        if (timeMatch) {
          pushIp = timeMatch[1] || '';
          pushTime = timeMatch[2] || '';
          rest = rest.substring(0, timeMatch.index).trimEnd();
        }

        if (tag === '推') pushStats.push++;
        else if (tag === '噓') pushStats.boo++;
        else pushStats.arrow++;

        // Check if push contains image links & YouTube links
        const pushImages = this.extractImageUrls(rest);
        const pushYoutubes = this.extractYoutubeUrls(rest);

        pushList.push({
          sourceLine: i,
          repairColumns: bbsColumns(line.trimEnd()) === columns
            ? columns - bbsColumns(line.slice(0, line.length - pushMatch[3].length))
              - (pushTime ? bbsColumns((pushIp ? pushIp + ' ' : '') + pushTime) + 1 : 0)
            : 0,
          floor: pushList.length + 1,
          tag,
          user,
          content: rest,
          time: pushTime,
          ip: pushIp,
          images: pushImages,
          youtubes: pushYoutubes,
        });
        continue;
      }

      bodyBlocks.push({ type: 'line', text: line, sourceLine: i,
        images: this.extractImageUrls(line), youtubes: this.extractYoutubeUrls(line) });
    }

    const applyRepair = (first, second, repair) => {
      first.repairedCont = repair;
      first.repairNextLine = second.sourceLine;
      second.previousRepair = repair;
      second.repairPreviousLine = first.sourceLine;
      // Replace the incomplete candidate, including a partial Imgur/video ID.
      const replaced = first.content ?? first.text;
      const complete = replaced.slice(0, repair.urlStartCol) + repair.repairedRaw;
      first.images = this.extractImageUrls(complete);
      first.youtubes = this.extractYoutubeUrls(complete);
    };
    for (let n = 0; n < bodyBlocks.length - 1; n++) {
      const first = bodyBlocks[n], second = bodyBlocks[n + 1];
      if (second.sourceLine !== first.sourceLine + 1) continue;
      const repair = repairBrokenUrl(first.text, second.text, null, { columns });
      if (repair) applyRepair(first, second, repair);
    }
    for (let n = 0; n < pushList.length - 1; n++) {
      const first = pushList[n], second = pushList[n + 1];
      if (second.sourceLine !== first.sourceLine + 1 || first.user.toLowerCase() !== second.user.toLowerCase()) continue;
      const repair = repairBrokenUrl(first.content, second.content, first.user, { columns: first.repairColumns });
      if (repair) applyRepair(first, second, repair);
    }

    return {
      author: author || 'BBS 使用者',
      title: title || 'BBS 文章',
      time: time || '',
      board: board || 'BBS',
      aidBoard: board || null, // BBS is a display placeholder, never a navigation target.
      bodyBlocks,
      pushList,
      pushStats,
    };
  }

  static extractImageUrls(text) {
    if (!text) return [];
    const urlRegex = /https?:\/\/[^\s\x00-\x1f<>"'()]+|(?:www\.|reurl\.cc\/|tinyurl\.com\/|bit\.ly\/|imgur\.com\/|i\.imgur\.com\/)[^\s\x00-\x1f<>"'()]+/gi;
    const matches = text.match(urlRegex) || [];
    const images = [];

    matches.forEach((u) => {
      let cleanUrl = u.replace(/[.,;:!?]+$/, '');
      if (!/^(https?|telnet|ftp):\/\//i.test(cleanUrl)) {
        cleanUrl = 'https://' + cleanUrl;
      }
      if (isImageUrl(cleanUrl)) {
        images.push({
          raw: u,
          url: normalizeImageUrl(cleanUrl),
        });
      }
    });

    return images;
  }

  static extractYoutubeUrls(text) {
    if (!text) return [];
    const ytRegex = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s]*&)?v=|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi;
    const matches = [];
    const seen = new Set();
    let m;
    while ((m = ytRegex.exec(text)) !== null) {
      const videoId = m[1];
      if (!seen.has(videoId)) {
        seen.add(videoId);
        matches.push({
          raw: m[0],
          videoId,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        });
      }
    }
    return matches;
  }
}

export class ArticleReaderModal {
  constructor() {
    this.modalEl = null;
    this.lightboxEl = null;
    this.fontSize = 16;
    this.isOpen = false;
    this.currentArticle = null;
    this.onEditUserTag = null;
    this.onShowToast = null;
    this.currentFilter = 'all';
    this.pushSearchQuery = '';
    this.highlightedUser = null;
    let savedMerge = false;
    try {
      savedMerge = typeof localStorage !== 'undefined' && localStorage.getItem('bbsterm_reader_merge_pushes') === 'true';
    } catch {}
    this.mergeConsecutive = savedMerge;
    this.createDom();

    blacklistManager.onChange(() => {
      if (this.isOpen && this.currentArticle) {
        const scroll = document.getElementById('reader-scroll-container');
        const top = scroll?.scrollTop || 0;
        this.renderArticle(this.currentArticle);
        if (scroll) scroll.scrollTop = top;
      }
    });
  }

  createDom() {
    // 1. Article Reader Modal Container
    const modal = document.createElement('div');
    modal.id = 'article-reader-modal';
    modal.className = 'article-reader-modal hidden';

    modal.innerHTML = `
      <div class="reader-header-bar">
        <div class="reader-nav-left">
          <button id="reader-close-btn" class="btn-reader-close" title="關閉好讀版 (ESC)">✕ 關閉好讀版</button>
          <span id="reader-board-badge" class="reader-board-badge">BBS</span>
        </div>
        <div class="reader-nav-right">
          <div class="font-size-controls">
            <button id="reader-font-dec" title="縮小字體">A-</button>
            <span id="reader-font-val">16px</span>
            <button id="reader-font-inc" title="放大字體">A+</button>
          </div>
          <button id="reader-jump-push-btn" class="btn-reader-action" title="快速捲動至推文區">💬 跳至留言</button>
          <button id="reader-copy-btn" class="btn-reader-action" title="複製文章連結與內容">📋 複製內容</button>
        </div>
      </div>
      <div class="reader-body-scroll" id="reader-scroll-container">
        <div class="reader-container">
          <div class="reader-meta-card">
            <h1 id="reader-title" class="reader-title">載入中...</h1>
            <div class="reader-meta-row">
              <div class="meta-item"><span class="meta-label">作者</span> <span id="reader-author" class="meta-val"></span></div>
              <div class="meta-item"><span class="meta-label">時間</span> <span id="reader-time" class="meta-val"></span></div>
            </div>
          </div>
          <div id="reader-article-content" class="reader-article-content"></div>
          <div id="reader-push-section" class="reader-push-section">
            <div class="push-header">
              <div class="push-title">💬 留言推文區</div>
              <div id="push-stats" class="push-stats"></div>
            </div>
            <div class="push-toolbar">
              <div class="push-filter-tabs">
                <button class="push-filter-btn active" data-filter="all">全部 <span class="filter-count" id="count-all">0</span></button>
                <button class="push-filter-btn filter-up" data-filter="push">🟢 只看推 <span class="filter-count" id="count-push">0</span></button>
                <button class="push-filter-btn filter-down" data-filter="boo">🔴 只看噓 <span class="filter-count" id="count-boo">0</span></button>
                <button class="push-filter-btn filter-arrow" data-filter="arrow">⚪ 只看箭頭 <span class="filter-count" id="count-arrow">0</span></button>
                <button class="push-filter-btn filter-author" data-filter="author">✍️ 只看原PO <span class="filter-count" id="count-author">0</span></button>
              </div>
              <div class="push-tools-right">
                <button type="button" id="push-merge-toggle" class="push-tool-btn" title="合併同作者相鄰連續推文 (例 1F~3F)">🔗 連續推文合併</button>
                <div class="push-search-box">
                  <input type="text" id="push-search-input" placeholder="🔍 搜尋推文內容或鄉民 ID..." />
                </div>
              </div>
            </div>
            <div id="push-tracking-bar" class="push-tracking-bar hidden"></div>
            <div id="push-list" class="push-list"></div>
          </div>
        </div>
      </div>
      <button id="reader-scroll-top-btn" class="reader-floating-btn hidden" title="回到頂端">🔝</button>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    // 2. Lightbox Modal for zooming in on images
    const lightbox = document.createElement('div');
    lightbox.id = 'reader-lightbox';
    lightbox.className = 'reader-lightbox hidden';
    lightbox.innerHTML = `
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-content">
        <img id="lightbox-img" src="" alt="Zoomed image" referrerpolicy="no-referrer" />
        <button class="lightbox-close">&times;</button>
        <div id="lightbox-caption" class="lightbox-caption"></div>
      </div>
    `;
    const lightboxImg = lightbox.querySelector('#lightbox-img');
    if (lightboxImg) {
      lightboxImg.onerror = () => {
        if (lightboxImg.dataset.originalSrc && !lightboxImg.dataset.proxyTried) {
          lightboxImg.dataset.proxyTried = 'true';
          lightboxImg.src = getProxiedImageUrl(lightboxImg.dataset.originalSrc);
        }
      };
    }
    document.body.appendChild(lightbox);
    this.lightboxEl = lightbox;

    // Wire Events
    document.getElementById('reader-close-btn')?.addEventListener('click', () => this.close());
    document.getElementById('reader-font-dec')?.addEventListener('click', () => this.adjustFontSize(-2));
    document.getElementById('reader-font-inc')?.addEventListener('click', () => this.adjustFontSize(2));
    document.getElementById('reader-copy-btn')?.addEventListener('click', () => this.copyArticle());

    // Jump to push section
    document.getElementById('reader-jump-push-btn')?.addEventListener('click', () => {
      document.getElementById('reader-push-section')?.scrollIntoView({ behavior: 'smooth' });
    });

    // Scroll to top
    const scrollTopBtn = document.getElementById('reader-scroll-top-btn');
    scrollTopBtn?.addEventListener('click', () => {
      document.getElementById('reader-scroll-container')?.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Toggle scroll to top button
    const scrollContainer = document.getElementById('reader-scroll-container');
    scrollContainer?.addEventListener('scroll', () => {
      if (scrollTopBtn) {
        scrollTopBtn.classList.toggle('hidden', scrollContainer.scrollTop < 250);
      }
    });

    // Push filter tabs
    modal.querySelectorAll('.push-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.push-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter || 'all';
        this.renderPushList();
      });
    });

    // Push search input
    document.getElementById('push-search-input')?.addEventListener('input', (e) => {
      this.pushSearchQuery = e.target.value.trim();
      this.renderPushList();
    });

    // Push merge toggle button
    const mergeToggleBtn = document.getElementById('push-merge-toggle');
    if (mergeToggleBtn) {
      mergeToggleBtn.classList.toggle('active', Boolean(this.mergeConsecutive));
      mergeToggleBtn.addEventListener('click', () => {
        this.mergeConsecutive = !this.mergeConsecutive;
        mergeToggleBtn.classList.toggle('active', Boolean(this.mergeConsecutive));
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('bbsterm_reader_merge_pushes', this.mergeConsecutive ? 'true' : 'false');
          }
        } catch {}
        this.renderPushList();
      });
    }

    this.lightboxEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('lightbox-backdrop') || e.target.classList.contains('lightbox-close')) {
        this.closeLightbox();
      }
    });

    // Close on ESC
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        if (!this.lightboxEl.classList.contains('hidden')) {
          this.closeLightbox();
        } else {
          this.close();
        }
      }
    });
  }

  adjustFontSize(delta) {
    this.fontSize = Math.max(12, Math.min(26, this.fontSize + delta));
    const fontVal = document.getElementById('reader-font-val');
    if (fontVal) fontVal.textContent = `${this.fontSize}px`;
    const content = document.getElementById('reader-article-content');
    if (content) content.style.fontSize = `${this.fontSize}px`;
  }

  openLightbox(url) {
    const img = document.getElementById('lightbox-img');
    const caption = document.getElementById('lightbox-caption');
    if (img) {
      img.dataset.originalSrc = url;
      img.dataset.proxyTried = '';
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    }
    if (caption) caption.textContent = url;
    this.lightboxEl.classList.remove('hidden');
  }

  closeLightbox() {
    this.lightboxEl.classList.add('hidden');
    const img = document.getElementById('lightbox-img');
    if (img) {
      img.src = '';
      img.dataset.originalSrc = '';
      img.dataset.proxyTried = '';
    }
  }

  copyArticle() {
    const title = document.getElementById('reader-title')?.textContent || '';
    const author = document.getElementById('reader-author')?.textContent || '';
    const content = document.getElementById('reader-article-content')?.innerText || '';
    const textToCopy = `【${title}】\n作者: ${author}\n\n${content}`;
    writeClipboardText(textToCopy).then(() => {
      const btn = document.getElementById('reader-copy-btn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✅ 已複製！';
        setTimeout(() => { btn.textContent = orig; }, 1800);
      }
    });
  }

  getScreenLines(buf) {
    const rawLines = [];
    for (let r = 0; r < buf.rows; r++) {
      let lineStr = '';
      for (let c = 0; c < buf.cols; c++) {
        const cell = buf.lines[r][c];
        if (!cell || cell.isTrailByte) continue;
        lineStr += cell.ch || ' ';
      }
      rawLines.push(lineStr.trimEnd());
    }
    return rawLines;
  }

  isArticleScreen(lines) {
    const headerCheck = lines.slice(0, 5).some((l) => /^作者\s*[:：]|^標題\s*[:：]|^看板\s*[:：]/.test(l));
    const footerCheck = lines.slice(20, 24).some((l) => /瀏覽\s+第\s+\d+\/\d+\s+頁|目前顯示\s*[:：]|\(\s*\d+%\)|\(y\)回應|\(F\)轉寄|※\s*文章網址/.test(l));
    return headerCheck || footerCheck;
  }

  waitForBufferUpdate(tab, timeoutMs = 400) {
    return new Promise((resolve) => {
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
          setTimeout(resolve, 40); // small delay to let full ANSI burst settle
        }
      };
    });
  }

  async crawlFullArticle(tab, onProgress) {
    if (!this.sendToTab || !this.getConnectionSession) throw new Error('文章傳輸介面尚未初始化');
    const session = await this.getConnectionSession(tab.id);
    const send = data => this.sendToTab(tab.id, data, session);
    const allLinesMap = new Map(); // lineIndex -> text
    const fallbackLines = [];

    // Rewind to top: Send Home key ('\x1b[1~')
    const updatePromise = this.waitForBufferUpdate(tab, 250);
    await send('\x1b[1~');
    await updatePromise;

    let pageCount = 0;
    let consecutiveUnchanged = 0;
    let lastScreenHash = '';

    while (pageCount < 100) {
      pageCount++;
      const screen = this.getScreenLines(tab.buf);
      const contentRows = screen.slice(0, 23); // lines 0..22

      // Check footer for line range (e.g. "目前顯示: 第 01~23 行" or "第 21~43 行")
      let lineRangeFound = false;
      for (let r = 23; r >= 20; r--) {
        const line = screen[r] || '';
        const lineMatch = line.match(/目前顯示\s*[:：]?\s*第\s*0*(\d+)\s*[~～-]\s*0*(\d+)\s*行/);
        if (lineMatch) {
          const startNum = parseInt(lineMatch[1], 10);
          contentRows.forEach((txt, idx) => {
            allLinesMap.set(startNum + idx, txt);
          });
          lineRangeFound = true;
          break;
        }
      }

      if (!lineRangeFound) {
        // Fallback to overlap merging if line numbers not in footer
        if (fallbackLines.length === 0) {
          fallbackLines.push(...contentRows);
        } else {
          let overlap = 0;
          for (let check = Math.min(fallbackLines.length, 14); check >= 2; check--) {
            const tail = fallbackLines.slice(fallbackLines.length - check).join('\n');
            const head = contentRows.slice(0, check).join('\n');
            if (tail === head) {
              overlap = check;
              break;
            }
          }
          fallbackLines.push(...contentRows.slice(overlap));
        }
      }

      const totalLinesCount = allLinesMap.size > 0 ? allLinesMap.size : fallbackLines.length;
      onProgress?.(pageCount, totalLinesCount);

      // Check end of article condition
      const footer = screen[23] || screen[22] || '';
      const pageMatch = footer.match(/瀏覽\s+第\s+(\d+)\/(\d+)\s+頁/);
      let isLastPage = false;
      if (pageMatch) {
        const currP = parseInt(pageMatch[1], 10);
        const totalP = parseInt(pageMatch[2], 10);
        if (currP >= totalP) isLastPage = true;
      }
      if (footer.includes('100%') || isLastPage) {
        break;
      }

      const currentHash = contentRows.join('\n');
      if (currentHash === lastScreenHash) {
        consecutiveUnchanged++;
        if (consecutiveUnchanged >= 2) {
          break;
        }
      } else {
        consecutiveUnchanged = 0;
      }
      lastScreenHash = currentHash;

      // Send Space / PageDown and wait for buffer update event from BBS
      const waitNext = this.waitForBufferUpdate(tab, 350);
      await send(' ');
      await waitNext;
    }

    if (allLinesMap.size > 0) {
      const sortedKeys = Array.from(allLinesMap.keys()).sort((a, b) => a - b);
      return sortedKeys.map((k) => allLinesMap.get(k));
    }

    return fallbackLines;
  }

  clearPushSection() {
    this.currentArticle = null;
    this.revealedPushes = new Set();
    this.articleBodyRevealed = false;
    this.highlightedUser = null;
    this.pushSearchQuery = '';
    this.currentFilter = 'all';

    const searchInput = document.getElementById('push-search-input');
    if (searchInput) searchInput.value = '';

    const modal = this.modalEl;
    if (modal && modal.querySelectorAll) {
      modal.querySelectorAll('.push-filter-btn').forEach((b) => {
        if (b.dataset?.filter === 'all') b.classList.add('active');
        else b.classList.remove('active');
      });
    }

    const pushListEl = document.getElementById('push-list');
    if (pushListEl) pushListEl.innerHTML = '';

    const pushStatsEl = document.getElementById('push-stats');
    if (pushStatsEl) pushStatsEl.innerHTML = '';

    const trackingBar = document.getElementById('push-tracking-bar');
    if (trackingBar) {
      trackingBar.classList.add('hidden');
      trackingBar.innerHTML = '';
    }

    const countAll = document.getElementById('count-all');
    const countPush = document.getElementById('count-push');
    const countBoo = document.getElementById('count-boo');
    const countArrow = document.getElementById('count-arrow');
    const countAuthor = document.getElementById('count-author');
    if (countAll) countAll.textContent = '0';
    if (countPush) countPush.textContent = '0';
    if (countBoo) countBoo.textContent = '0';
    if (countArrow) countArrow.textContent = '0';
    if (countAuthor) countAuthor.textContent = '0';
  }

  async open(tab) {
    if (!tab || !tab.buf) return;

    this.modalEl.classList.remove('hidden');
    this.isOpen = true;
    this.clearPushSection();

    const titleEl = document.getElementById('reader-title');
    const contentEl = document.getElementById('reader-article-content');
    const authorEl = document.getElementById('reader-author');
    const timeEl = document.getElementById('reader-time');
    const boardEl = document.getElementById('reader-board-badge');
    const scrollContainer = document.getElementById('reader-scroll-container');
    if (scrollContainer) scrollContainer.scrollTop = 0;

    const screenLines = this.getScreenLines(tab.buf);
    const isArticle = this.isArticleScreen(screenLines);

    if (isArticle && tab.isConnected) {
      if (titleEl) titleEl.textContent = '📖 正在載入完整長文與所有推文...';
      if (authorEl) authorEl.textContent = '讀取中...';
      if (timeEl) timeEl.textContent = '';
      if (boardEl) boardEl.textContent = 'BBS';
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="reader-loading-box">
            <div class="reader-spinner"></div>
            <div id="reader-loading-text">正在自動掃描文章分頁...</div>
          </div>
        `;
      }

      let fullLines;
      try {
        fullLines = await this.crawlFullArticle(tab, (page, totalLines) => {
          const loadingText = document.getElementById('reader-loading-text');
          if (loadingText) {
            loadingText.textContent = `正在快速抓取第 ${page} 頁 (已累積 ${totalLines} 行)...`;
          }
        });
      } catch (error) {
        this.onShowToast?.(`文章讀取已停止：${error.message || error}`);
        this.renderArticle(ArticleParser.parseLines(this.getScreenLines(tab.buf)));
        return;
      }

      const article = ArticleParser.parseLines(fullLines);
      this.renderArticle(article);
    } else {
      const article = ArticleParser.parseLines(screenLines);
      this.renderArticle(article);
    }
  }

  renderArticle(article) {
    if (this.currentArticle !== article) {
      this.revealedPushes = new Set();
      this.articleBodyRevealed = false;
    }
    this.currentArticle = article;
    this.revealedPushes ||= new Set();
    // Populate metadata
    const titleEl = document.getElementById('reader-title');
    const authorEl = document.getElementById('reader-author');
    const timeEl = document.getElementById('reader-time');
    const boardEl = document.getElementById('reader-board-badge');

    const matchedTitleKw = blacklistManager.isKeywordBlacklisted(article.title);
    if (titleEl) {
      if (matchedTitleKw && blacklistManager.getMode() !== 'dim') {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.textContent = '🛡️ 標題符合黑名單規則，點擊查看';
        reveal.addEventListener('click', () => { titleEl.textContent = article.title; });
        titleEl.replaceChildren(reveal);
      } else if (matchedTitleKw) {
        titleEl.innerHTML = `${this.escapeHtml(article.title)} <span class="reader-title-badge blacklisted" title="標題包含黑名單關鍵字「${this.escapeHtml(matchedTitleKw)}」">🚫 關鍵字: ${this.escapeHtml(matchedTitleKw)}</span>`;
      } else {
        titleEl.textContent = article.title;
      }
    }

    const authorUser = article.author ? article.author.split('(')[0].trim() : '';
    const isAuthorBlacklisted = authorUser ? blacklistManager.isBlacklisted(authorUser) : false;
    const authorTag = userTagsManager.getTag(authorUser);
    const authorTagHtml = authorTag && authorTag.tag ? (() => {
      const col = TAG_COLORS[authorTag.color] || TAG_COLORS.blue;
      const noteTitle = authorTag.note ? ` title="備註: ${authorTag.note.replace(/"/g, '&quot;')}"` : '';
      return ` <span class="user-tag-badge" data-user="${this.escapeHtml(authorUser)}" style="color: ${col.text}; background: ${col.bg}; border-color: ${col.border}; cursor: pointer;"${noteTitle}>🏷️ ${this.escapeHtml(authorTag.tag)}</span>`;
    })() : '';

    const hasAuthorRule = blacklistManager.hasUserRule(authorUser);
    const authorBlacklistBtn = authorUser ? ` <button type="button" class="btn-author-blacklist${hasAuthorRule ? ' active' : ''}" data-user="${this.escapeHtml(authorUser)}" title="${hasAuthorRule ? '已在黑名單中 (點擊移出)' : '將作者加入黑名單'}">${hasAuthorRule ? '🚫 已黑名單' : '🚫 封鎖作者'}</button>` : '';

    if (authorEl) {
      authorEl.innerHTML = (isAuthorBlacklisted
        ? `${this.escapeHtml(article.author)} <span class="reader-author-badge blacklisted" title="此作者已被列入黑名單">🚫 黑名單作者</span>`
        : this.escapeHtml(article.author)) + authorTagHtml + authorBlacklistBtn;

      authorEl.querySelector('.btn-author-blacklist')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const u = e.currentTarget.dataset.user;
        if (u) {
          try {
            const added = blacklistManager.toggle(u);
            this.onShowToast?.(added ? `🚫 已將作者 ${u} 加入黑名單` : `✅ 已將作者 ${u} 移出黑名單`);
          } catch (error) { this.onShowToast?.(`黑名單未變更：${error.message}`); }
        }
      });

      authorEl.querySelectorAll('.user-tag-badge').forEach((badge) => {
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          const u = badge.dataset.user;
          if (u) this.onEditUserTag?.(u);
        });
      });
    }
    if (timeEl) timeEl.textContent = article.time;
    if (boardEl) boardEl.textContent = article.board;

    const mode = blacklistManager.getMode();
    const isArticleBlacklisted = isAuthorBlacklisted || Boolean(matchedTitleKw);
    const articleReason = isAuthorBlacklisted ? `作者 ${authorUser} 已列入黑名單` : `標題包含黑名單關鍵字「${matchedTitleKw}」`;

    // Render Body Blocks
    const contentEl = document.getElementById('reader-article-content');
    if (contentEl) {
      contentEl.innerHTML = '';
      contentEl.classList.remove('blacklisted-article-dim');
      contentEl.style.fontSize = `${this.fontSize}px`;

      if (isArticleBlacklisted && (mode === 'mask' || mode === 'hide')) {
        const maskBanner = document.createElement('div');
        maskBanner.className = 'article-masked-banner';
        maskBanner.innerHTML = `
          <span>🛡️ 此文章符合您的黑名單規則（${this.escapeHtml(articleReason)}）</span>
          <button type="button" class="btn-reveal-article">點擊顯示內文</button>
        `;
        contentEl.appendChild(maskBanner);

        const bodyContainer = document.createElement('div');
        bodyContainer.className = `article-masked-body${this.articleBodyRevealed ? '' : ' hidden'}`;
        contentEl.appendChild(bodyContainer);

        maskBanner.querySelector('.btn-reveal-article')?.addEventListener('click', (e) => {
          const isHidden = bodyContainer.classList.toggle('hidden');
          this.articleBodyRevealed = !isHidden;
          e.target.textContent = isHidden ? '點擊顯示內文' : '隱藏內文';
        });

        const revealButton = maskBanner.querySelector('.btn-reveal-article');
        if (revealButton && this.articleBodyRevealed) revealButton.textContent = '隱藏內文';
        this.renderBodyBlocks(article.bodyBlocks, bodyContainer);
      } else {
        if (isArticleBlacklisted && mode === 'dim') {
          contentEl.classList.add('blacklisted-article-dim');
        } else {
          contentEl.classList.remove('blacklisted-article-dim');
        }
        this.renderBodyBlocks(article.bodyBlocks, contentEl);
      }
    }

    // Update Push Stats Header
    const pushStatsEl = document.getElementById('push-stats');
    if (pushStatsEl) {
      const { push, boo, arrow } = article.pushStats;
      pushStatsEl.innerHTML = `
        <span class="push-badge push">推 ${push}</span>
        <span class="push-badge boo">噓 ${boo}</span>
        <span class="push-badge arrow">→ ${arrow}</span>
        <span class="push-total">共 ${push + boo + arrow} 則留言</span>
      `;
    }

    // Update Filter Tab Badge Counts
    const countAll = document.getElementById('count-all');
    const countPush = document.getElementById('count-push');
    const countBoo = document.getElementById('count-boo');
    const countArrow = document.getElementById('count-arrow');
    const countAuthor = document.getElementById('count-author');

    const totalPushes = article.pushList ? article.pushList.length : 0;
    const authorPushes = article.pushList
      ? article.pushList.filter((p) => p.user.trim().toLowerCase() === authorUser.toLowerCase()).length
      : 0;

    if (countAll) countAll.textContent = String(totalPushes);
    if (countPush) countPush.textContent = String(article.pushStats.push);
    if (countBoo) countBoo.textContent = String(article.pushStats.boo);
    if (countArrow) countArrow.textContent = String(article.pushStats.arrow);
    if (countAuthor) countAuthor.textContent = String(authorPushes);

    // Render Push List with Filters & Floor Numbers
    this.renderPushList();
  }

  renderBodyBlocks(blocks, targetContainer) {
    if (!blocks || !targetContainer) return;
    blocks.forEach((block) => {
      const p = document.createElement('div');
      p.className = 'reader-line';

      p.innerHTML = this.formatLineHtml(block.text, block.repairedCont, block.previousRepair);
      targetContainer.appendChild(p);

      if (block.images && block.images.length > 0) {
        block.images.forEach((imgObj) => {
          let imageUrl;
          try {
            const parsed = new URL(imgObj.url);
            if (!['https:', 'http:'].includes(parsed.protocol)) return;
            imageUrl = parsed.href;
          } catch { return; }
          const imgContainer = document.createElement('div');
          imgContainer.className = 'reader-image-card';

          const img = document.createElement('img');
          img.className = 'reader-inline-image';
          img.referrerPolicy = 'no-referrer';
          img.src = imageUrl;
          img.alt = imgObj.raw;
          img.loading = 'lazy';
          img.title = '點擊檢視放大原圖';

          img.onerror = () => {
            if (!img.dataset.proxyTried) {
              img.dataset.proxyTried = 'true';
              img.src = getProxiedImageUrl(imageUrl);
            } else {
              img.classList.add('reader-img-broken');
              img.title = '圖片載入失敗，點擊下方連結開啟原圖';
            }
          };

          img.onclick = () => this.openLightbox(img.src || imageUrl);

          const imgCap = document.createElement('div');
          imgCap.className = 'reader-img-caption';
          const link = document.createElement('a');
          link.href = imageUrl;
          link.target = '_blank';
          link.rel = 'noreferrer noopener';
          link.textContent = imgObj.raw;
          imgCap.append('🔗 ', link);

          imgContainer.appendChild(img);
          imgContainer.appendChild(imgCap);
          targetContainer.appendChild(imgContainer);
        });
      }

      if (block.youtubes && block.youtubes.length > 0) {
        block.youtubes.forEach((yt) => {
          targetContainer.appendChild(this.createYoutubeCard(yt));
        });
      }
    });
  }

  createYoutubeCard(yt) {
    const card = document.createElement('div');
    card.className = 'reader-yt-card';
    card.innerHTML = `
      <div class="yt-thumb-wrapper" title="點擊在好讀模式中直接播放影片">
        <img class="yt-thumb" src="${yt.thumbnailUrl}" alt="YouTube Preview" loading="lazy" referrerpolicy="no-referrer" />
        <div class="yt-play-btn">▶</div>
      </div>
      <div class="yt-info-bar">
        <span class="yt-icon">▶ YouTube 影片</span>
        <a href="${yt.watchUrl}" target="_blank" rel="noreferrer" class="yt-link" title="在新分頁開啟 YouTube">${yt.raw}</a>
      </div>
    `;

    const thumbWrapper = card.querySelector('.yt-thumb-wrapper');
    thumbWrapper?.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.className = 'yt-embed-iframe';
      iframe.src = `${yt.embedUrl}?autoplay=1`;
      iframe.title = 'YouTube video player';
      iframe.frameBorder = '0';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      card.replaceChildren(iframe);
    });

    return card;
  }

  pushJoiner(previous, next) {
    return previous.repairedCont || !(/[a-zA-Z0-9]$/.test(previous.content) && /^[a-zA-Z0-9]/.test(next.content)) ? '' : ' ';
  }

  // Reveal ownership belongs to original article pushes, never render wrappers.
  isPushGroupRevealed(group) {
    return (group.pushes || [group]).every(push => this.revealedPushes?.has(push));
  }

  getPushGroupBlacklist(group) {
    const isUserBlacklisted = blacklistManager.isBlacklisted(group.user);
    const pushes = group.pushes || [group];
    let matchedKeyword = blacklistManager.isKeywordBlacklisted(group.content);
    if (!matchedKeyword) {
      for (const push of pushes) {
        if (push.content === group.content) continue;
        matchedKeyword = blacklistManager.isKeywordBlacklisted(push.content);
        if (matchedKeyword) break;
      }
    }
    return { isUserBlacklisted, matchedKeyword, isPushBlacklisted: isUserBlacklisted || Boolean(matchedKeyword) };
  }

  groupConsecutivePushes(pushList) {
    if (!Array.isArray(pushList) || pushList.length === 0) return [];
    const groups = [];
    let currentGroup = null;

    for (let i = 0; i < pushList.length; i++) {
      const p = pushList[i];
      if (!currentGroup) {
        currentGroup = {
          floor: p.floor,
          floorEnd: p.floor,
          user: p.user,
          tag: p.tag,
          time: p.time,
          ip: p.ip,
          sourceLine: p.sourceLine,
          sourceLines: [p.sourceLine],
          pushes: [p],
          content: p.content,
        };
        groups.push(currentGroup);
        continue;
      }

      const prevPush = currentGroup.pushes[currentGroup.pushes.length - 1];
      const isConsecutiveLine = p.sourceLine === prevPush.sourceLine + 1;
      const isSameUser = p.user.trim().toLowerCase() === currentGroup.user.trim().toLowerCase();

      // Tag compatibility rule:
      // Primary tag '推' can merge with '推' or '→'
      // Primary tag '噓' can merge with '噓' or '→'
      // Primary tag '→' can merge with '→'
      const isTagCompatible = (
        (currentGroup.tag === '推' && (p.tag === '推' || p.tag === '→')) ||
        (currentGroup.tag === '噓' && (p.tag === '噓' || p.tag === '→')) ||
        (currentGroup.tag === '→' && p.tag === '→')
      );

      if (isConsecutiveLine && isSameUser && isTagCompatible) {
        currentGroup.pushes.push(p);
        currentGroup.floorEnd = p.floor;
        if (p.time) currentGroup.time = p.time;
        if (p.ip) currentGroup.ip = p.ip;
        currentGroup.sourceLines.push(p.sourceLine);
        const glue = this.pushJoiner(prevPush, p);
        currentGroup.content += glue + p.content;
      } else {
        currentGroup = {
          floor: p.floor,
          floorEnd: p.floor,
          user: p.user,
          tag: p.tag,
          time: p.time,
          ip: p.ip,
          sourceLine: p.sourceLine,
          sourceLines: [p.sourceLine],
          pushes: [p],
          content: p.content,
        };
        groups.push(currentGroup);
      }
    }

    return groups.map(g => ({
      ...g,
      floorLabel: g.floor === g.floorEnd ? `${g.floor}F` : `${g.floor}~${g.floorEnd}F`,
    }));
  }

  renderPushList() {
    const pushListEl = document.getElementById('push-list');
    if (!pushListEl || !this.currentArticle) return;
    pushListEl.innerHTML = '';

    const authorUser = this.currentArticle.author ? this.currentArticle.author.split('(')[0].trim().toLowerCase() : '';
    let rawList = this.currentArticle.pushList || [];
    // Apply type filters to original pushes. Preserve sourceLine gaps when grouping.
    if (this.currentFilter === 'push') rawList = rawList.filter(p => p.tag === '推');
    else if (this.currentFilter === 'boo') rawList = rawList.filter(p => p.tag === '噓');
    else if (this.currentFilter === 'arrow') rawList = rawList.filter(p => p.tag === '→');
    else if (this.currentFilter === 'author') rawList = rawList.filter(p => p.user.trim().toLowerCase() === authorUser);
    let list = this.mergeConsecutive
      ? this.groupConsecutivePushes(rawList)
      : rawList.map(p => (p.pushes ? p : { ...p, pushes: [p], floorLabel: `${Number.isInteger(p.floor) ? p.floor : 1}F` }));

    // 2. Filter by Search Query
    if (this.pushSearchQuery) {
      const q = this.pushSearchQuery.toLowerCase();
      list = list.filter((p) =>
        p.user.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
      );
    }

    const mode = blacklistManager.getMode();
    const blacklistByGroup = new Map(list.map(group => [group, this.getPushGroupBlacklist(group)]));
    if (mode === 'hide') list = list.filter(group => !blacklistByGroup.get(group).isPushBlacklisted);

    // 3. User Tracking Bar
    const trackingBar = document.getElementById('push-tracking-bar');
    if (trackingBar) {
      if (this.highlightedUser) {
        const userPushesCount = list.reduce((count, p) => count + (p.user.trim().toLowerCase() === this.highlightedUser ? (p.pushes || [p]).length : 0), 0);
        trackingBar.innerHTML = `
          <span>🎯 正在高亮追蹤鄉民：<strong class="tracking-user-name">${this.escapeHtml(this.highlightedUser)}</strong>（目前篩選結果共 ${userPushesCount} 則推文）</span>
          <button type="button" class="push-tracking-clear-btn" title="取消追蹤">✕ 取消追蹤</button>
        `;
        trackingBar.classList.remove('hidden');
        trackingBar.querySelector('.push-tracking-clear-btn')?.addEventListener('click', () => {
          this.highlightedUser = null;
          this.renderPushList();
        });
      } else {
        trackingBar.classList.add('hidden');
        trackingBar.innerHTML = '';
      }
    }

    if (list.length === 0) {
      pushListEl.innerHTML = '<div class="push-empty">沒有符合篩選條件的推文</div>';
      return;
    }

    const visibleBySourceLine = new Map();
    list.forEach(p => {
      for (const sub of (p.pushes || [p])) {
        visibleBySourceLine.set(sub.sourceLine, p);
      }
    });

    list.forEach((p) => {
      const { isUserBlacklisted, matchedKeyword, isPushBlacklisted } = blacklistByGroup.get(p);
      const reason = isUserBlacklisted ? `帳號 ${p.user}` : `關鍵字「${matchedKeyword}」`;

      const repairVisible = partnerLine => {
        const partner = visibleBySourceLine.get(partnerLine);
        if (!partner) return false;
        const blocked = blacklistByGroup.get(partner).isPushBlacklisted;
        return !blocked || mode === 'dim' || (mode === 'mask' && this.isPushGroupRevealed(partner));
      };

      const pushes = p.pushes || [p];
      let pushContentHtml = '';
      for (let idx = 0; idx < pushes.length; idx++) {
        const sub = pushes[idx];
        const forwardRepair = sub.repairedCont && repairVisible(sub.repairNextLine) ? sub.repairedCont : null;
        const previousRepair = sub.previousRepair && repairVisible(sub.repairPreviousLine) ? sub.previousRepair : null;
        const subHtml = this.formatLineHtml(sub.content, forwardRepair, previousRepair);
        if (idx > 0) {
          const prevSub = pushes[idx - 1];
          const glue = this.pushJoiner(prevSub, sub);
          pushContentHtml += glue;
        }
        pushContentHtml += subHtml;
      }

      const pushTag = userTagsManager.getTag(p.user);
      const pushTagHtml = pushTag && pushTag.tag ? (() => {
        const col = TAG_COLORS[pushTag.color] || TAG_COLORS.blue;
        const noteTitle = pushTag.note ? ` title="備註: ${pushTag.note.replace(/"/g, '&quot;')}"` : '';
        return ` <span class="user-tag-badge mini" data-user="${this.escapeHtml(p.user)}" style="color: ${col.text}; background: ${col.bg}; border-color: ${col.border}; cursor: pointer;"${noteTitle}>🏷️ ${this.escapeHtml(pushTag.tag)}</span>`;
      })() : '';

      const isAuthor = authorUser && p.user.trim().toLowerCase() === authorUser;
      const authorBadgeHtml = isAuthor ? ' <span class="push-author-badge" title="此推文由文章原作者發表 (點擊追蹤)">✍️ 原PO</span>' : '';
      const hasUserRule = blacklistManager.hasUserRule(p.user);
      const quickBlacklistBtn = ` <button type="button" class="push-quick-blacklist-btn${hasUserRule ? ' active' : ''}" data-user="${this.escapeHtml(p.user)}" title="${hasUserRule ? '已在黑名單中 (點擊移出)' : '將此用戶加入黑名單'}">${hasUserRule ? '🚫 已黑' : '🚫'}</button>`;

      const isUserHighlighted = Boolean(this.highlightedUser && p.user.trim().toLowerCase() === this.highlightedUser);
      const isUserDimmed = Boolean(this.highlightedUser && !isUserHighlighted);

      const row = document.createElement('div');
      row.className = `push-item push-type-${p.tag === '推' ? 'up' : p.tag === '噓' ? 'down' : 'neutral'}${isPushBlacklisted ? ' blacklisted-push' : ''}${isAuthor ? ' is-author-push' : ''}${isUserHighlighted ? ' is-user-highlighted' : ''}${isUserDimmed ? ' is-user-dimmed' : ''}`;

      const floorLabel = p.floorLabel || (Number.isInteger(p.floor) ? `${p.floor}F` : '1F');

      if (isPushBlacklisted && mode === 'mask') {
        const revealPushes = p.pushes || [p];
        const revealed = this.isPushGroupRevealed(p);
        row.innerHTML = `
          <div class="push-masked-banner">
            <span class="push-floor">${this.escapeHtml(floorLabel)}</span>
            <span class="push-mask-label">🛡️ 依黑名單規則隱藏 (${this.escapeHtml(reason)})</span>
            <button type="button" class="push-mask-reveal-btn">${revealed ? '收起' : '點擊查看'}</button>
          </div>
          <div class="push-masked-body${revealed ? '' : ' hidden'}">
            <span class="push-floor">${this.escapeHtml(floorLabel)}</span>
            <span class="push-tag">${this.escapeHtml(p.tag)}</span>
            <span class="push-user"><span class="push-user-name" title="點擊高亮追蹤此鄉民留言">${this.escapeHtml(p.user)}</span>${authorBadgeHtml}${pushTagHtml}${quickBlacklistBtn}</span>
            <span class="push-content">${pushContentHtml}</span>
            <span class="push-time">${this.escapeHtml(p.ip ? p.ip + ' ' : '')}${this.escapeHtml(p.time)}</span>
          </div>
        `;
        row.querySelector('.push-mask-reveal-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const body = row.querySelector('.push-masked-body');
          if (body) {
            const isHidden = body.classList.toggle('hidden');
            this.revealedPushes ||= new Set();
            for (const original of revealPushes) {
              if (isHidden) this.revealedPushes.delete(original);
              else this.revealedPushes.add(original);
            }
            e.target.textContent = isHidden ? '點擊查看' : '收起';
          }
        });
      } else {
        row.innerHTML = `
          <span class="push-floor">${this.escapeHtml(floorLabel)}</span>
          <span class="push-tag">${this.escapeHtml(p.tag)}</span>
          <span class="push-user"><span class="push-user-name" title="點擊高亮追蹤此鄉民留言">${this.escapeHtml(p.user)}</span>${authorBadgeHtml}${pushTagHtml}${quickBlacklistBtn}${isPushBlacklisted ? ` <span class="push-blacklist-badge" title="${this.escapeHtml(reason)}">🚫</span>` : ''}</span>
          <span class="push-content">${pushContentHtml}</span>
          <span class="push-time">${this.escapeHtml(p.ip ? p.ip + ' ' : '')}${this.escapeHtml(p.time)}</span>
        `;
      }

      // User click tracking
      const toggleUserHighlight = (e) => {
        e.stopPropagation();
        const u = p.user.trim().toLowerCase();
        this.highlightedUser = (this.highlightedUser === u) ? null : u;
        this.renderPushList();
      };
      row.querySelector('.push-user-name')?.addEventListener('click', toggleUserHighlight);
      row.querySelector('.push-author-badge')?.addEventListener('click', toggleUserHighlight);

      row.querySelector('.push-quick-blacklist-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const u = e.currentTarget.dataset.user;
        if (u) {
          try {
            const added = blacklistManager.toggle(u);
            this.onShowToast?.(added ? `🚫 已將 ${u} 加入黑名單` : `✅ 已將 ${u} 移出黑名單`);
          } catch (error) { this.onShowToast?.(`黑名單未變更：${error.message}`); }
        }
      });

      row.querySelector('.user-tag-badge')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onEditUserTag?.(p.user);
      });

      // Media belongs to the masked body and is created only after explicit reveal.
      const mediaTarget = isPushBlacklisted && mode === 'mask'
        ? row.querySelector('.push-masked-body') : row;
      const renderMedia = () => {
        if (!mediaTarget || mediaTarget.dataset.mediaLoaded === 'true') return;
        mediaTarget.dataset.mediaLoaded = 'true';
        const seenUrls = new Set();
        for (const sub of pushes) {
          const forwardRepair = sub.repairedCont && repairVisible(sub.repairNextLine) ? sub.repairedCont : null;
          for (const imgObj of (sub.repairedCont && !forwardRepair ? [] : sub.images) || []) {
            let imageUrl;
            try {
              const url = new URL(imgObj.url);
              if (!['http:', 'https:'].includes(url.protocol)) continue;
              imageUrl = url.href;
            } catch { continue; }
            if (seenUrls.has(imageUrl)) continue;
            seenUrls.add(imageUrl);
            const img = document.createElement('img');
            img.className = 'push-inline-img';
            img.referrerPolicy = 'no-referrer';
            img.src = imageUrl;
            img.alt = String(imgObj.raw || '推文圖片');
            img.loading = 'lazy';
            img.title = '點擊檢視放大原圖';
            img.onerror = () => {
              if (!img.dataset.proxyTried) {
                img.dataset.proxyTried = 'true';
                img.src = getProxiedImageUrl(imageUrl);
              } else {
                img.classList.add('push-img-broken');
                img.title = '圖片載入失敗';
              }
            };
            img.addEventListener('click', () => this.openLightbox(img.src || imageUrl));
            mediaTarget.appendChild(img);
          }
          for (const yt of (sub.repairedCont && !forwardRepair ? [] : sub.youtubes) || []) {
            const ytKey = yt.videoId || yt.url;
            if (seenUrls.has(ytKey)) continue;
            seenUrls.add(ytKey);
            mediaTarget.appendChild(this.createYoutubeCard(yt));
          }
        }
      };
      if (isPushBlacklisted && mode === 'mask') {
        if (this.isPushGroupRevealed(p)) renderMedia();
        row.querySelector('.push-mask-reveal-btn')?.addEventListener('click', () => {
          if (pushes.some(s => s.repairedCont || s.previousRepair)) { this.renderPushList(); return; }
          if (!mediaTarget?.classList.contains('hidden')) renderMedia();
        });
      } else renderMedia();

      pushListEl.appendChild(row);
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  refresh() {
    if (this.isOpen && this.currentArticle) {
      this.renderArticle(this.currentArticle);
    }
  }

  formatLineHtml(str, repairedCont = null, prevRepairedCont = null) {
    if (!str) return '&nbsp;';
    const spans = [];
    const urlRegex = /(https?:\/\/[^\s\x00-\x1f<>"'()]+|(?:www\.|reurl\.cc\/|tinyurl\.com\/|bit\.ly\/|ptt\.cc\/)[^\s\x00-\x1f<>"'()]+)/gi;
    let match;
    while ((match = urlRegex.exec(str))) {
      let target = match[0];
      if (repairedCont && repairedCont.urlStartCol === match.index && repairedCont.urlPart1 === target) target = repairedCont.repairedUrl;
      if (!/^(?:https?):\/\//i.test(target)) target = 'https://' + target;
      spans.push({ start: match.index, end: match.index + match[0].length, target });
    }
    if (prevRepairedCont) {
      const { contStartCol: start, contToken: token, repairedUrl: target } = prevRepairedCont;
      if (str.slice(start, start + token.length) === token && !spans.some(span => span.start < start + token.length && span.end > start)) {
        spans.push({ start, end: start + token.length, target });
      }
    }
    // Extract AIDs (PTT Article IDs)
    const aidBoard = this.currentArticle && Object.hasOwn(this.currentArticle, 'aidBoard') ? this.currentArticle.aidBoard : this.currentArticle?.board;
    const aids = extractAidsFromLine(str, aidBoard);
    for (const aid of aids) {
      const start = aid.startCol;
      const end = aid.endCol + 1;
      const overlaps = spans.some(s => (start < s.end && end > s.start));
      if (!overlaps && aid.url) {
        spans.push({
          start,
          end,
          target: aid.url,
          isAid: true,
          aid: aid.aid,
          board: aid.board,
        });
      }
    }
    let end = 0, html = '';
    for (const span of spans.sort((a, b) => a.start - b.start)) {
      html += this.escapeHtml(str.slice(end, span.start));
      if (span.isAid) {
        const title = `文章代碼 ${span.aid}${span.board ? ` (${span.board})` : ''} • 開啟 PTT 網頁版`;
        html += `<a href="${this.escapeHtml(span.target)}" data-aid="${this.escapeHtml(span.aid)}" data-board="${this.escapeHtml(span.board || '')}" class="reader-link reader-aid-link" target="_blank" rel="noreferrer" title="${this.escapeHtml(title)}">${this.escapeHtml(str.slice(span.start, span.end))}</a>`;
      } else {
        html += `<a href="${this.escapeHtml(span.target)}" target="_blank" class="reader-link" rel="noreferrer">${this.escapeHtml(str.slice(span.start, span.end))}</a>`;
      }
      end = span.end;
    }
    return html + this.escapeHtml(str.slice(end));
  }

  close() {
    this.modalEl.classList.add('hidden');
    this.closeLightbox();
    this.clearPushSection();
    this.isOpen = false;
  }
}

export const articleReader = new ArticleReaderModal();
