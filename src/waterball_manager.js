// Advanced Waterball (水球) History & Message Manager for Waterball BBS

export class WaterballManager {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.logs = this.loadLogs();
    this.listeners = [];
  }

  loadLogs() {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem('bbsterm_waterball_logs');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          return obj;
        }
      }
    } catch (e) {
      console.warn('Failed to load waterball logs from storage:', e);
    }
    return {};
  }

  saveLogs() {
    if (!this.storage) return;
    try {
      this.storage.setItem('bbsterm_waterball_logs', JSON.stringify(this.logs));
    } catch (e) {
      console.warn('Failed to save waterball logs to storage:', e);
    }
    this.notify();
  }

  addIncomingMessage({ sender, message, timeStr = '', tabId = '', tabTitle = 'PTT' }) {
    if (!sender || !message) return null;
    const cleanSender = String(sender).trim();
    const contactKey = cleanSender.toLowerCase();
    const cleanMsg = String(message).trim();

    if (!this.logs[contactKey]) {
      this.logs[contactKey] = [];
    }

    const msgObj = {
      id: `wb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      contactId: contactKey,
      contactName: cleanSender,
      sender: cleanSender,
      receiver: 'me',
      message: cleanMsg,
      time: timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      timestamp: Date.now(),
      isMine: false,
      isRead: false,
      tabId,
      tabTitle,
    };

    this.logs[contactKey].push(msgObj);
    // Keep max 200 messages per contact to conserve memory
    if (this.logs[contactKey].length > 200) {
      this.logs[contactKey].shift();
    }

    this.saveLogs();
    return msgObj;
  }

  addOutgoingMessage({ receiver, message, timeStr = '', tabId = '', tabTitle = 'PTT' }) {
    if (!receiver || !message) return null;
    const cleanReceiver = String(receiver).trim();
    const contactKey = cleanReceiver.toLowerCase();
    const cleanMsg = String(message).trim();

    if (!this.logs[contactKey]) {
      this.logs[contactKey] = [];
    }

    const msgObj = {
      id: `wb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      contactId: contactKey,
      contactName: cleanReceiver,
      sender: 'me',
      receiver: cleanReceiver,
      message: cleanMsg,
      time: timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      timestamp: Date.now(),
      isMine: true,
      isRead: true,
      tabId,
      tabTitle,
    };

    this.logs[contactKey].push(msgObj);
    if (this.logs[contactKey].length > 200) {
      this.logs[contactKey].shift();
    }

    this.saveLogs();
    return msgObj;
  }

  getContacts() {
    const contacts = [];
    for (const [key, msgList] of Object.entries(this.logs)) {
      if (!Array.isArray(msgList) || msgList.length === 0) continue;
      const lastMsg = msgList[msgList.length - 1];
      const unreadCount = msgList.filter((m) => !m.isMine && !m.isRead).length;

      contacts.push({
        contactId: key,
        contactName: lastMsg.contactName || key,
        lastMessage: lastMsg.message,
        lastTime: lastMsg.time,
        lastTimestamp: lastMsg.timestamp,
        unreadCount,
        totalCount: msgList.length,
      });
    }

    return contacts.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }

  getMessages(contactId) {
    if (!contactId) return [];
    const key = String(contactId).trim().toLowerCase();
    return this.logs[key] ? [...this.logs[key]] : [];
  }

  markRead(contactId) {
    if (!contactId) return;
    const key = String(contactId).trim().toLowerCase();
    const list = this.logs[key];
    if (list && Array.isArray(list)) {
      let changed = false;
      list.forEach((m) => {
        if (!m.isRead) {
          m.isRead = true;
          changed = true;
        }
      });
      if (changed) {
        this.saveLogs();
      }
    }
  }

  getTotalUnreadCount() {
    let count = 0;
    for (const msgList of Object.values(this.logs)) {
      if (Array.isArray(msgList)) {
        count += msgList.filter((m) => !m.isMine && !m.isRead).length;
      }
    }
    return count;
  }

  deleteConversation(contactId) {
    if (!contactId) return false;
    const key = String(contactId).trim().toLowerCase();
    if (this.logs[key]) {
      delete this.logs[key];
      this.saveLogs();
      return true;
    }
    return false;
  }

  clearAll() {
    this.logs = {};
    this.saveLogs();
  }

  exportJson() {
    return JSON.stringify(this.logs, null, 2);
  }

  importJson(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('格式錯誤：必須為 JSON 物件');
      }

      let count = 0;
      for (const [key, msgList] of Object.entries(parsed)) {
        if (Array.isArray(msgList)) {
          const contactKey = key.trim().toLowerCase();
          if (!this.logs[contactKey]) {
            this.logs[contactKey] = [];
          }
          msgList.forEach((m) => {
            if (m && m.message) {
              this.logs[contactKey].push({
                id: m.id || `wb_${Date.now()}_${Math.random()}`,
                contactId: contactKey,
                contactName: m.contactName || m.sender || key,
                sender: m.sender || 'someone',
                receiver: m.receiver || 'me',
                message: String(m.message).trim(),
                time: m.time || '',
                timestamp: Number(m.timestamp) || Date.now(),
                isMine: Boolean(m.isMine),
                isRead: true,
              });
              count++;
            }
          });
        }
      }

      this.saveLogs();
      return { success: true, count };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  addListener(fn) {
    if (typeof fn === 'function' && !this.listeners.includes(fn)) {
      this.listeners.push(fn);
    }
  }

  removeListener(fn) {
    const idx = this.listeners.indexOf(fn);
    if (idx !== -1) {
      this.listeners.splice(idx, 1);
    }
  }

  notify() {
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (e) {
        console.error('Error in waterball listener:', e);
      }
    }
  }
}

export const waterballManager = new WaterballManager();
