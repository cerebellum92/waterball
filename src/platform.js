import { writeText as writeNativeText, writeImage as writeNativeImage } from '@tauri-apps/plugin-clipboard-manager';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

const isTauri = () => Boolean(typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__));

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

const getInvoke = () => {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || null;
};

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

