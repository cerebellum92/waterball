// Rich Article Reader Mode (圖文好讀版) for bbsterm

import { isImageUrl, normalizeImageUrl } from './image_preview.js';

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

    return this.parseLines(rawLines);
  }

  static parseLines(lines) {
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
        if (/^作者\s*[:：]\s*(.+)/.test(line)) {
          author = line.match(/^作者\s*[:：]\s*(.+)/)[1].trim();
          continue;
        }
        if (/^標題\s*[:：]\s*(.+)/.test(line)) {
          title = line.match(/^標題\s*[:：]\s*(.+)/)[1].trim();
          continue;
        }
        if (/^時間\s*[:：]\s*(.+)/.test(line)) {
          time = line.match(/^時間\s*[:：]\s*(.+)/)[1].trim();
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

        // Check if push contains image links
        const pushImages = this.extractImageUrls(rest);

        pushList.push({
          tag,
          user,
          content: rest,
          time: pushTime,
          ip: pushIp,
          images: pushImages,
        });
        continue;
      }

      // Standard Article Body Line
      const imageUrls = this.extractImageUrls(line);
      bodyBlocks.push({
        type: 'line',
        text: line,
        images: imageUrls,
      });
    }

    return {
      author: author || 'BBS 使用者',
      title: title || 'BBS 文章',
      time: time || '',
      board: board || 'BBS',
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
}

export class ArticleReaderModal {
  constructor() {
    this.modalEl = null;
    this.lightboxEl = null;
    this.fontSize = 16;
    this.isOpen = false;
    this.createDom();
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
          <button id="reader-copy-btn" class="btn-reader-action" title="複製文章連結與內容">📋 複製內容</button>
        </div>
      </div>
      <div class="reader-body-scroll">
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
            <div id="push-list" class="push-list"></div>
          </div>
        </div>
      </div>
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
        <img id="lightbox-img" src="" alt="Zoomed image" />
        <button class="lightbox-close">&times;</button>
        <div id="lightbox-caption" class="lightbox-caption"></div>
      </div>
    `;
    document.body.appendChild(lightbox);
    this.lightboxEl = lightbox;

    // Wire Events
    document.getElementById('reader-close-btn')?.addEventListener('click', () => this.close());
    document.getElementById('reader-font-dec')?.addEventListener('click', () => this.adjustFontSize(-2));
    document.getElementById('reader-font-inc')?.addEventListener('click', () => this.adjustFontSize(2));
    document.getElementById('reader-copy-btn')?.addEventListener('click', () => this.copyArticle());

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
    if (img) img.src = url;
    if (caption) caption.textContent = url;
    this.lightboxEl.classList.remove('hidden');
  }

  closeLightbox() {
    this.lightboxEl.classList.add('hidden');
    const img = document.getElementById('lightbox-img');
    if (img) img.src = '';
  }

  copyArticle() {
    const title = document.getElementById('reader-title')?.textContent || '';
    const author = document.getElementById('reader-author')?.textContent || '';
    const content = document.getElementById('reader-article-content')?.innerText || '';
    const textToCopy = `【${title}】\n作者: ${author}\n\n${content}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
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
    const { invoke } = window.__TAURI__.core;
    const allLinesMap = new Map(); // lineIndex -> text
    const fallbackLines = [];

    // Rewind to top: Send Home key ('\x1b[1~')
    const updatePromise = this.waitForBufferUpdate(tab, 250);
    await invoke('send_input', { tabId: tab.id, data: '\x1b[1~' }).catch(() => {});
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
      await invoke('send_input', { tabId: tab.id, data: ' ' }).catch(() => {});
      await waitNext;
    }

    if (allLinesMap.size > 0) {
      const sortedKeys = Array.from(allLinesMap.keys()).sort((a, b) => a - b);
      return sortedKeys.map((k) => allLinesMap.get(k));
    }

    return fallbackLines;
  }

  async open(tab) {
    if (!tab || !tab.buf) return;

    this.modalEl.classList.remove('hidden');
    this.isOpen = true;

    const titleEl = document.getElementById('reader-title');
    const contentEl = document.getElementById('reader-article-content');
    const authorEl = document.getElementById('reader-author');
    const timeEl = document.getElementById('reader-time');
    const boardEl = document.getElementById('reader-board-badge');

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

      const fullLines = await this.crawlFullArticle(tab, (page, totalLines) => {
        const loadingText = document.getElementById('reader-loading-text');
        if (loadingText) {
          loadingText.textContent = `正在快速抓取第 ${page} 頁 (已累積 ${totalLines} 行)...`;
        }
      });

      const article = ArticleParser.parseLines(fullLines);
      this.renderArticle(article);
    } else {
      const article = ArticleParser.parseLines(screenLines);
      this.renderArticle(article);
    }
  }

  renderArticle(article) {
    // Populate metadata
    const titleEl = document.getElementById('reader-title');
    const authorEl = document.getElementById('reader-author');
    const timeEl = document.getElementById('reader-time');
    const boardEl = document.getElementById('reader-board-badge');

    if (titleEl) titleEl.textContent = article.title;
    if (authorEl) authorEl.textContent = article.author;
    if (timeEl) timeEl.textContent = article.time;
    if (boardEl) boardEl.textContent = article.board;

    // Render Body Blocks
    const contentEl = document.getElementById('reader-article-content');
    if (contentEl) {
      contentEl.innerHTML = '';
      contentEl.style.fontSize = `${this.fontSize}px`;

      article.bodyBlocks.forEach((block) => {
        const p = document.createElement('div');
        p.className = 'reader-line';

        // Auto-linkify URLs in text line
        p.innerHTML = this.formatLineHtml(block.text);
        contentEl.appendChild(p);

        // In-place embedded images
        if (block.images && block.images.length > 0) {
          block.images.forEach((imgObj) => {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'reader-image-card';

            const img = document.createElement('img');
            img.className = 'reader-inline-image';
            img.src = imgObj.url;
            img.alt = imgObj.raw;
            img.loading = 'lazy';
            img.title = '點擊檢視放大原圖';

            img.onclick = () => this.openLightbox(imgObj.url);

            const imgCap = document.createElement('div');
            imgCap.className = 'reader-img-caption';
            imgCap.innerHTML = `🔗 <a href="${imgObj.url}" target="_blank" rel="noreferrer">${imgObj.raw}</a>`;

            imgContainer.appendChild(img);
            imgContainer.appendChild(imgCap);
            contentEl.appendChild(imgContainer);
          });
        }
      });
    }

    // Render Push Comments
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

    const pushListEl = document.getElementById('push-list');
    if (pushListEl) {
      pushListEl.innerHTML = '';
      if (article.pushList.length === 0) {
        pushListEl.innerHTML = '<div class="push-empty">目前此篇文章尚無推文</div>';
      } else {
        article.pushList.forEach((p) => {
          const row = document.createElement('div');
          row.className = `push-item push-type-${p.tag === '推' ? 'up' : p.tag === '噓' ? 'down' : 'neutral'}`;

          row.innerHTML = `
            <span class="push-tag">${p.tag}</span>
            <span class="push-user">${p.user}</span>
            <span class="push-content">${this.formatLineHtml(p.content)}</span>
            <span class="push-time">${p.ip ? p.ip + ' ' : ''}${p.time}</span>
          `;

          // If push has images, embed them under push
          if (p.images && p.images.length > 0) {
            const pushImgs = document.createElement('div');
            pushImgs.className = 'push-images';
            p.images.forEach((imgObj) => {
              const img = document.createElement('img');
              img.className = 'push-inline-img';
              img.src = imgObj.url;
              img.loading = 'lazy';
              img.onclick = () => this.openLightbox(imgObj.url);
              pushImgs.appendChild(img);
            });
            row.appendChild(pushImgs);
          }

          pushListEl.appendChild(row);
        });
      }
    }
  }

  formatLineHtml(str) {
    if (!str) return '&nbsp;';
    const escaped = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Linkify URLs
    const urlRegex = /(https?:\/\/[^\s\x00-\x1f<>"'()]+|(?:www\.|reurl\.cc\/|tinyurl\.com\/|bit\.ly\/|ptt\.cc\/)[^\s\x00-\x1f<>"'()]+)/gi;
    return escaped.replace(urlRegex, (match) => {
      let target = match;
      if (!/^(https?|telnet|ftp):\/\//i.test(target)) {
        target = 'https://' + target;
      }
      return `<a href="${target}" target="_blank" class="reader-link" rel="noreferrer">${match}</a>`;
    });
  }

  close() {
    this.modalEl.classList.add('hidden');
    this.closeLightbox();
    this.isOpen = false;
  }
}

export const articleReader = new ArticleReaderModal();
