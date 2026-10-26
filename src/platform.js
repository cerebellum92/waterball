import {
  writeText as writeNativeText,
  writeImage as writeNativeImage,
  readText as readNativeText,
  readImage as readNativeImage,
} from '@tauri-apps/plugin-clipboard-manager';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export const isTauri = () => Boolean(typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__));

export const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
  );
};

export const isIOS = () => {
  if (typeof window === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

export const getInvoke = () => {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || null;
};

export async function safeInvoke(cmd, args = {}) {
  const invoke = getInvoke();
  if (typeof invoke === 'function') {
    return await invoke(cmd, args);
  }
  throw new Error(`此環境尚未支援原生操作：${cmd}（無可用的 Tauri IPC）`);
}

export const getListen = () => {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.event?.listen || null;
};

export async function openExternalUrl(url) {
  if (isTauri()) {
    const invoke = getInvoke();
    if (typeof invoke === 'function') {
      try {
        await invoke('open_browser_url', { url });
        return;
      } catch (err) {
        console.warn('Tauri open_browser_url failed, falling back:', err);
      }
    }
  }

  if (typeof window !== 'undefined' && window.open) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function requestNotificationPermission() {
  if (isTauri()) {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      return granted;
    } catch (error) {
      console.warn('Native notification permission unavailable:', error);
      return false;
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted') {
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch (error) {
      console.warn('Notification permission error:', error);
    }
  }
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
}

export async function readClipboardText(options = {}) {
  if (isTauri()) {
    try {
      const text = await readNativeText();
      if (typeof text === 'string') return text;
    } catch (error) {
      console.warn('Native clipboard read unavailable:', error);
      if (options.interactive === false) return '';
      throw new Error('無法讀取系統剪貼簿文字，請確認已複製文字後再試');
    }
    // Native failures must never fall through to WKWebView clipboard reads,
    // including explicit Cmd+V; those APIs trigger a separate Paste popover.
    return '';
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      if (options.interactive === false) {
        if (!navigator.permissions?.query) return '';
        try {
          const permission = await navigator.permissions.query({ name: 'clipboard-read' });
          if (permission.state !== 'granted') return '';
        } catch { return ''; } // WebKit may not implement clipboard-read permissions.
      }
      return await navigator.clipboard.readText();
    } catch (error) {
      console.warn('Navigator clipboard readText failed:', error);
    }
  }
  return '';
}

export async function writeClipboardText(text) {
  if (isTauri()) {
    try {
      await writeNativeText(text);
      return;
    } catch (error) {
      console.warn('Native clipboard unavailable, using web fallback:', error);
    }
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(text);
}

export async function writeClipboardImage(blob) {
  if (!(blob instanceof Blob)) throw new TypeError('Expected an image Blob');

  if (isTauri()) {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await writeNativeImage(bytes);
      return;
    } catch (error) {
      console.warn('Native image clipboard unavailable, using web fallback:', error);
    }
  }

  if (!navigator.clipboard?.write || !window.ClipboardItem) {
    throw new Error('Image clipboard API is unavailable');
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
}

// Must run during paste dispatch, before the event's data store expires.
export function extractClipboardImage(cd) {
  if (cd) {
    if (cd.items) {
      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i];
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) return file;
        }
      }
    }
    if (cd.files && cd.files.length > 0) {
      for (let i = 0; i < cd.files.length; i++) {
        const file = cd.files[i];
        if (file.type && file.type.startsWith('image/')) {
          return file;
        }
      }
    }
    // A paste event is an authoritative snapshot. Text-only event data must
    // not start another clipboard read (or select a later clipboard image).
    return null;
  }
  return null;
}

export async function readClipboardImage(options = {}) {
  if (options.clipboardData) return extractClipboardImage(options.clipboardData);

  // 2. Native Tauri clipboard
  if (isTauri()) {
    let img;
    try {
      img = await readNativeImage();
      if (img && typeof img.size === 'function' && typeof img.rgba === 'function') {
        const { width, height } = await img.size();
        // Bound decoded memory before fetching RGBA or creating a canvas.
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
            width <= 0 || height <= 0 || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) {
          throw new RangeError('剪貼簿圖片尺寸過大，限 8192 邊長及 16MP');
        }
        if (width > 0 && height > 0) {
          const rgba = await img.rgba();
          if (typeof document !== 'undefined') {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(width, height);
            imgData.data.set(rgba);
            ctx.putImageData(imgData, 0, 0);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (blob) return blob;
          }
        }
      }
    } catch (error) {
      if (error instanceof RangeError) throw error;
      // No image in clipboard or permission error
    } finally {
      try { await img?.close?.(); } catch {}
    }
    // Probing an ordinary text clipboard as an image is expected to fail.
    // Do not turn that normal result into navigator.clipboard.read() on WebKit.
    return null;
  }

  // 3. Web / Extension navigator.clipboard.read()
  if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
    try {
      if (options.interactive === false) {
        if (!navigator.permissions?.query) return null;
        try {
          const permission = await navigator.permissions.query({ name: 'clipboard-read' });
          if (permission.state !== 'granted') return null;
        } catch { return null; }
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            if (blob) return blob;
          }
        }
      }
    } catch {
      // Permission denied or no image
    }
  }

  return null;
}

export async function sendNativeNotification(title, body, onWebClick, options = {}) {
  if (isTauri()) {
    const invoke = getInvoke();
    if (typeof invoke === 'function') {
      try {
        await invoke('send_system_notification', {
          title,
          body,
          subtitle: options.subtitle || null,
          url: options.url || null,
          sound: options.sound !== false,
        });
        return true;
      } catch (cmdError) {
        console.warn('send_system_notification command error:', cmdError);
        if (options.throwOnError) {
          throw cmdError instanceof Error ? cmdError : new Error(String(cmdError));
        }
        return false;
      }
    }

    try {
      const granted = await requestNotificationPermission();
      if (granted) {
        sendNotification({ title, body, silent: options.sound === false });
        return true;
      }
    } catch (error) {
      console.warn('Native notification plugin unavailable, using web fallback:', error);
    }
    return false;
  }

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body,
      silent: options.sound === false,
    });
    if (onWebClick) notification.onclick = onWebClick;
    return true;
  }
  return false;
}

// Desktop storage uses the current OS user’s application profile.
export const platformStorage = {
  async get(key, defaultValue = null) {
    const value = localStorage.getItem(key);
    return value !== null ? JSON.parse(value) : defaultValue;
  },
  async set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};
