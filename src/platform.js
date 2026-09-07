import { writeText as writeNativeText, writeImage as writeNativeImage } from '@tauri-apps/plugin-clipboard-manager';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

const isTauri = () => Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);

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

  if ('Notification' in window && Notification.permission !== 'granted') {
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch (error) {
      console.warn('Notification permission error:', error);
    }
  }
  return 'Notification' in window && Notification.permission === 'granted';
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

export async function sendNativeNotification(title, body, onWebClick) {
  if (isTauri()) {
    try {
      const granted = await requestNotificationPermission();
      if (granted) {
        sendNotification({ title, body, silent: true });
        return true;
      }
    } catch (error) {
      console.warn('Native notification unavailable, using web fallback:', error);
    }
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, { body, silent: true });
    if (onWebClick) notification.onclick = onWebClick;
    return true;
  }
  return false;
}
