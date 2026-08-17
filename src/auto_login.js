// Auto-Login Controller for BBS Sessions (PTT / MapleBBS / Bahamut)

export class AutoLoginManager {
  constructor() {
    this.sessions = new Map(); // tabId -> AutoLoginSession
    this.onStatusChange = null;
  }

  startSession(tabId, credentials, sendDataFn) {
    if (!credentials || !credentials.username || !credentials.password) {
      return;
    }

    this.stopSession(tabId);

    const session = {
      tabId,
      username: credentials.username,
      password: credentials.password,
      sendData: sendDataFn,
      state: 'WAIT_USER', // 'WAIT_USER' | 'WAIT_PASS' | 'WAIT_ANYKEY' | 'DONE'
      buffer: '',
      timeoutTimer: null,
      actionTimer: null,
    };

    // Safety timeout: auto cancel after 20 seconds
    session.timeoutTimer = setTimeout(() => {
      this.stopSession(tabId);
    }, 20000);

    this.sessions.set(tabId, session);
    this.onStatusChange?.(tabId, '🔐 正在自動登入...');
  }

  feedData(tabId, data) {
    const session = this.sessions.get(tabId);
    if (!session || session.state === 'DONE') return;

    const chunk = typeof data === 'string' ? data : '';
    session.buffer += chunk;
    if (session.buffer.length > 2048) {
      session.buffer = session.buffer.slice(-1024);
    }

    const text = session.buffer;

    if (session.state === 'WAIT_USER') {
      if (/請輸入代號|請輸入帳號|login\s*[:：]|代號\s*[:：]|帳號\s*[:：]|guest.*參觀|new.*註冊/i.test(text)) {
        session.state = 'SENDING_USER';
        session.buffer = ''; // reset buffer for next stage
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          // Send username string
          session.sendData(session.username);
          // Send Enter after 80ms to ensure BBS input loop receives full token + newline
          setTimeout(() => {
            session.sendData('\r');
            session.state = 'WAIT_PASS';
          }, 80);
        }, 120);
      }
    } else if (session.state === 'WAIT_PASS') {
      if (/請輸入密碼|password\s*[:：]|密碼\s*[:：]|您的密碼/i.test(text)) {
        session.state = 'SENDING_PASS';
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          // Send password string
          session.sendData(session.password);
          // Send Enter after 80ms
          setTimeout(() => {
            session.sendData('\r');
            session.state = 'WAIT_ANYKEY';
          }, 80);
        }, 150);
      }
    } else if (session.state === 'WAIT_ANYKEY') {
      if (/請按任意鍵|按任意鍵|請按\s*Enter|重複登入|嘗試錯誤|刪除以上錯誤/i.test(text)) {
        session.state = 'SENDING_ANYKEY';
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          session.sendData('\r');
          session.state = 'DONE';
          this.onStatusChange?.(tabId, '自動登入完成');
          setTimeout(() => this.stopSession(tabId), 1000);
        }, 200);
      }
    }
  }

  stopSession(tabId) {
    const session = this.sessions.get(tabId);
    if (session) {
      clearTimeout(session.timeoutTimer);
      clearTimeout(session.actionTimer);
      this.sessions.delete(tabId);
    }
  }
}

export const autoLoginManager = new AutoLoginManager();

