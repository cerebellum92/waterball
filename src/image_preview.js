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

export function getProxiedImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const clean = url.trim();
  if (!clean || clean.startsWith('data:') || clean.startsWith('blob:') || clean.includes('images.weserv.nl')) {
    return clean;
  }
  return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}&default=1`;
}

export function normalizeImageUrl(url) {
  if (!url) return '';
  let clean = url.trim();

  // Upgrade http to https
  if (clean.startsWith('http://')) {
    clean = 'https://' + clean.substring(7);
  }

  // Normalize Twitter / X media links ending with :large or :orig
  if (/pbs\.twimg\.com\/media\/[^?]+\:(large|orig|medium|small)$/i.test(clean)) {
    clean = clean.replace(/\:(large|orig|medium|small)$/i, '?format=jpg&name=$1');
  }

  // Only rewrite actual Imgur page hosts. Direct-image URLs keep their
  // extension/query, so a repaired PNG is never silently changed to JPEG.
  try {
    const parsed = new URL(clean);
    if (/^(?:www\.|m\.)?imgur\.com$/i.test(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol)) {
      const image = parsed.pathname.match(/^\/(?:gallery\/)?([a-zA-Z0-9]+)(\.[a-zA-Z]+)?$/);
      if (image) return `https://i.imgur.com/${image[1]}${image[2] || '.jpg'}${parsed.search}${parsed.hash}`;
    }
  } catch { /* Preserve unsupported input for the caller to validate. */ }

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
    img.referrerPolicy = 'no-referrer';

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

      // Preload image with anti-hotlinking referrerPolicy and proxy fallback
      const tempImg = new Image();
      tempImg.referrerPolicy = 'no-referrer';
      let triedProxy = false;
      tempImg.onload = () => {
        if (this.currentUrl === targetUrl) {
          this.img.referrerPolicy = 'no-referrer';
          this.img.src = tempImg.src;
          this.img.style.display = 'block';
          this.spinner.style.display = 'none';
          this.updatePosition(clientX, clientY);
        }
      };
      tempImg.onerror = () => {
        if (!triedProxy) {
          triedProxy = true;
          tempImg.src = getProxiedImageUrl(targetUrl);
        } else if (this.currentUrl === targetUrl) {
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
