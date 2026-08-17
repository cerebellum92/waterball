// Inline Image Preview Overlay Controller

export function isImageUrl(url) {
  if (!url) return false;
  const clean = url.trim();

  // 1. Direct image extensions
  if (/\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i.test(clean)) {
    return true;
  }

  // 2. Imgur links (imgur.com/abc, i.imgur.com/abc, m.imgur.com/abc)
  if (/(?:i\.|m\.)?imgur\.com\/([a-zA-Z0-9]+)/i.test(clean)) {
    return true;
  }

  // 3. Twitter / X image CDN
  if (/pbs\.twimg\.com\/media\//i.test(clean)) {
    return true;
  }

  // 4. Reddit image CDN
  if (/(?:i|preview)\.redd\.it\//i.test(clean)) {
    return true;
  }

  // 5. Giphy
  if (/giphy\.com\/media\//i.test(clean) || /i\.giphy\.com\//i.test(clean)) {
    return true;
  }

  return false;
}

export function normalizeImageUrl(url) {
  if (!url) return '';
  let clean = url.trim();

  // Upgrade http to https
  if (clean.startsWith('http://')) {
    clean = 'https://' + clean.substring(7);
  }

  // Imgur page link to direct image link (e.g. imgur.com/abc -> i.imgur.com/abc.jpg)
  const imgurMatch = clean.match(/(?:https?:\/\/)?(?:m\.|www\.)?imgur\.com\/([a-zA-Z0-9]+)(?:\.[a-zA-Z]+)?$/i);
  if (imgurMatch && !clean.includes('/a/') && !clean.includes('/gallery/')) {
    return `https://i.imgur.com/${imgurMatch[1]}.jpg`;
  }

  return clean;
}

export class ImagePreviewController {
  constructor() {
    this.overlay = null;
    this.img = null;
    this.spinner = null;
    this.caption = null;
    this.currentUrl = null;
    this.showTimer = null;
    this.hideTimer = null;
    this.enabled = true;

    this.createDom();
  }

  createDom() {
    const overlay = document.createElement('div');
    overlay.id = 'image-preview-overlay';
    overlay.className = 'hidden';

    const spinner = document.createElement('div');
    spinner.className = 'preview-spinner';

    const img = document.createElement('img');
    img.className = 'preview-img';
    img.alt = 'Preview';

    const caption = document.createElement('div');
    caption.className = 'preview-caption';

    overlay.appendChild(spinner);
    overlay.appendChild(img);
    overlay.appendChild(caption);

    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.img = img;
    this.spinner = spinner;
    this.caption = caption;

    // Hide if user clicks on the preview
    this.overlay.addEventListener('click', () => {
      this.hideImmediate();
    });
  }

  show(rawUrl, clientX, clientY) {
    if (!this.enabled) return;
    if (!isImageUrl(rawUrl)) {
      this.hide();
      return;
    }

    const targetUrl = normalizeImageUrl(rawUrl);
    if (this.currentUrl === targetUrl && !this.overlay.classList.contains('hidden')) {
      this.updatePosition(clientX, clientY);
      return;
    }

    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);

    // 180ms hover debounce before showing
    this.showTimer = setTimeout(() => {
      this.currentUrl = targetUrl;
      this.spinner.style.display = 'block';
      this.img.style.display = 'none';
      this.caption.textContent = rawUrl;

      this.overlay.classList.remove('hidden');
      this.updatePosition(clientX, clientY);

      // Preload image
      const tempImg = new Image();
      tempImg.onload = () => {
        if (this.currentUrl === targetUrl) {
          this.img.src = targetUrl;
          this.img.style.display = 'block';
          this.spinner.style.display = 'none';
          this.updatePosition(clientX, clientY);
        }
      };
      tempImg.onerror = () => {
        if (this.currentUrl === targetUrl) {
          this.hideImmediate();
        }
      };
      tempImg.src = targetUrl;
    }, 180);
  }

  updatePosition(clientX, clientY) {
    if (!this.overlay || this.overlay.classList.contains('hidden')) return;

    const overlayW = 380;
    const overlayH = 320;
    const margin = 16;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let left = clientX + margin;
    let top = clientY + margin;

    // Flip to left if overflowing right edge
    if (left + overlayW > winW - margin) {
      left = Math.max(margin, clientX - overlayW - margin);
    }

    // Flip to top if overflowing bottom edge
    if (top + overlayH > winH - margin) {
      top = Math.max(margin, clientY - overlayH - margin);
    }

    this.overlay.style.left = `${left}px`;
    this.overlay.style.top = `${top}px`;
  }

  hide() {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);

    this.hideTimer = setTimeout(() => {
      this.hideImmediate();
    }, 80);
  }

  hideImmediate() {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.currentUrl = null;
    if (this.overlay) {
      this.overlay.classList.add('hidden');
      this.img.src = '';
    }
  }
}

export const imagePreview = new ImagePreviewController();
