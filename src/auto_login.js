// Auto-Login Controller for BBS Sessions (PTT / MapleBBS / Bahamut)

export class AutoLoginManager {
  constructor() {
    this.sessions = new Map(); // tabId -> AutoLoginSession
    this.onStatusChange = null;
  }

  startSession(tabId, credentials, sendDataFn, initialBufferText = '') {
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
      buffer: initialBufferText || '',
      timeoutTimer: null,
      actionTimer: null,
    };

    // Safety timeout: auto cancel after 20 seconds
    session.timeoutTimer = setTimeout(() => {
      this.stopSession(tabId);
    }, 20000);

    this.sessions.set(tabId, session);
    this.onStatusChange?.(tabId, '🔐 正在自動登入...');

    // If initial buffer already has login prompt, process immediately
    if (session.buffer) {
      this.processBuffer(session);
    }
  }

  feedData(tabId, data) {
    const session = this.sessions.get(tabId);
    if (!session || session.state === 'DONE') return;

    const chunk = typeof data === 'string' ? data : '';
    session.buffer += chunk;
    if (session.buffer.length > 2048) {
      session.buffer = session.buffer.slice(-1024);
    }

    this.processBuffer(session);
  }

  processBuffer(session) {
    const text = session.buffer;

    // 0. Safety Emergency Brake: Check for login failure / wrong password
    // Prevent continuous retry loops that could lock the user's PTT account!
    if (session.state !== 'WAIT_USER') {
      if (/密碼不對|密碼錯誤|無此帳號|密碼嘗試錯誤|密碼輸入錯誤|請重新輸入密碼|嘗試次數過多/i.test(text)) {
        session.state = 'FAILED';
        clearTimeout(session.actionTimer);
        clearTimeout(session.timeoutTimer);
        this.onStatusChange?.(session.tabId, '❌ 密碼錯誤！已停止自動登入以避免帳號被鎖');
        this.onLoginError?.(session.tabId, '偵測到密碼錯誤或無此帳號，已立即停止自動登入，避免帳號被鎖定。');
        this.stopSession(session.tabId);
        return;
      }
    }

    if (session.state === 'WAIT_USER') {
      if (/請輸入代號|請輸入帳號|login\s*[:：]|代號\s*[:：]|帳號\s*[:：]|guest.*參觀|new.*註冊/i.test(text)) {
        session.state = 'SENDING_USER';
        session.buffer = ''; // reset buffer for next stage
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          session.sendData(session.username + '\r');
          session.state = 'WAIT_PASS';
        }, 30);
      }
    } else if (session.state === 'WAIT_PASS') {
      if (/請輸入密碼|password\s*[:：]|密碼\s*[:：]|您的密碼/i.test(text)) {
        session.state = 'SENDING_PASS';
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          session.sendData(session.password + '\r');
          session.state = 'WAIT_ANYKEY';
        }, 30);
      }
    } else if (session.state === 'WAIT_ANYKEY') {
      if (/請按任意鍵|按任意鍵|請按\s*Enter|重複登入|刪除以上錯誤/i.test(text)) {
        session.state = 'SENDING_ANYKEY';
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          session.sendData('\r');
          session.state = 'DONE';
          this.onStatusChange?.(session.tabId, '自動登入完成');
          setTimeout(() => this.stopSession(session.tabId), 1000);
        }, 50);
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

