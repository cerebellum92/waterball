// Waterball (水球) & New Mail Notification Engine for bbsterm

import { settingsManager } from './settings.js';

export class NotificationManager {
  constructor() {
    this.recentCache = new Map(); // hash -> timestamp
    this.onTabBadgeTrigger = null; // (tabId) => void
    this.onFocusTab = null; // (tabId) => void
    this.audioCtx = null;
    this.initPermission();
  }

  initPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      // Defer requesting until first user interaction
    }
  }

  async requestPermission() {
    if ('Notification' in window && Notification.permission !== 'granted') {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn('Notification permission error:', e);
      }
    }
  }

  playChime() {
    if (settingsManager.settings.notifySound === false) return;
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) this.audioCtx = new AudioContextClass();
      }
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      // Tone 1: C5 (523.25 Hz)
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.18);

      // Tone 2: E5 (659.25 Hz)
      const osc2 = this.audioCtx.createOscillator();
      const gain2 = this.audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.08);
      gain2.gain.setValueAtTime(0.15, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc2.connect(gain2);
      gain2.connect(this.audioCtx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.28);
    } catch (e) {
      console.warn('Audio chime failed:', e);
    }
  }

  feedScreenLines(tabId, lines, tabTitle = 'BBS') {
    if (settingsManager.settings.notifyEnabled === false) return;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i] || '';
      const cleanLine = rawLine.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (!cleanLine) continue;

      // 1. Waterball Message Detection (PTT / MapleBBS)
      // Format: "★user 呼叫: message [08/16 15:30]" or "★user message [08/16 15:30]"
      const wbMatch = cleanLine.match(/★\s*([a-zA-Z0-9_-]{2,16})\s*(?:呼叫\s*[:：]?|\s+)(.*)$/);
      if (wbMatch) {
        const sender = wbMatch[1];
        let message = wbMatch[2].trim();

        // Strip trailing timestamp [MM/DD HH:MM]
        message = message.replace(/\[\d{2}\/\d{2}\s+\d{2}:\d{2}\]$/, '').trim();

        // Ignore common header artifacts
        if (sender !== 'BBS' && sender !== '站長' && message.length > 0) {
          this.triggerWaterballNotification(tabId, sender, message, tabTitle);
        }
      }

      // 2. New Mail Detection (PTT / MapleBBS)
      // Format: "● 您有新信件" or "您有新信件，請按 M 查閱"
      if (/●\s*您有新信件|您有新信件，請按|收到\s*新信件/i.test(cleanLine)) {
        this.triggerMailNotification(tabId, tabTitle);
      }
    }
  }

  triggerWaterballNotification(tabId, sender, message, tabTitle) {
    const hash = `wb:${tabId}:${sender}:${message}`;
    const now = Date.now();
    if (this.recentCache.has(hash) && now - this.recentCache.get(hash) < 6000) {
      return; // Deduplicate within 6 seconds
    }
    this.recentCache.set(hash, now);
    this.cleanCache();

    this.playChime();
    this.onTabBadgeTrigger?.(tabId);

    if ('Notification' in window && Notification.permission === 'granted') {
      const notif = new Notification(`💬 [${tabTitle} 水球] 來自 ${sender}`, {
        body: message,
        silent: true, // we handle sound with audioCtx
      });

      notif.onclick = () => {
        window.focus();
        this.onFocusTab?.(tabId);
      };
    }
  }

  triggerMailNotification(tabId, tabTitle) {
    const hash = `mail:${tabId}`;
    const now = Date.now();
    if (this.recentCache.has(hash) && now - this.recentCache.get(hash) < 20000) {
      return; // Deduplicate within 20 seconds
    }
    this.recentCache.set(hash, now);
    this.cleanCache();

    this.playChime();
    this.onTabBadgeTrigger?.(tabId);

    if ('Notification' in window && Notification.permission === 'granted') {
      const notif = new Notification(`✉️ [${tabTitle} 站內信]`, {
        body: '您收到了新的站內信件！',
        silent: true,
      });

      notif.onclick = () => {
        window.focus();
        this.onFocusTab?.(tabId);
      };
    }
  }

  cleanCache() {
    const now = Date.now();
    for (const [key, time] of this.recentCache.entries()) {
      if (now - time > 30000) {
        this.recentCache.delete(key);
      }
    }
  }
}

export const notificationManager = new NotificationManager();
