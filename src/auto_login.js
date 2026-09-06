// Auto-Login Controller for BBS Sessions (PTT / MapleBBS / Bahamut)

export class AutoLoginManager {
  constructor() {
    this.sessions = new Map(); // tabId -> AutoLoginSession
    this.onStatusChange = null;
    this.onLoginError = null;
  }

  startSession(tabId, credentials, sendDataFn, initialBufferText = '') {
    if (!credentials || !credentials.username) {
      return;
    }

    this.stopSession(tabId);

    const session = {
      tabId,
      username: credentials.username,
      password: credentials.password || '',
      sendData: sendDataFn,
      state: 'WAIT_USER', // 'WAIT_USER' | 'SENDING_USER' | 'WAIT_PASS' | 'SENDING_PASS' | 'WAIT_ANYKEY' | 'DONE'
      buffer: initialBufferText || '',
      anyKeyCount: 0,
      timeoutTimer: null,
      actionTimer: null,
    };

    // Safety timeout: auto cancel after 25 seconds
    session.timeoutTimer = setTimeout(() => {
      this.stopSession(tabId);
    }, 25000);

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
    if (session.buffer.length > 4096) {
      session.buffer = session.buffer.slice(-2048);
    }

    this.processBuffer(session);
  }

  checkScreenBuffer(tabId, screenText) {
    const session = this.sessions.get(tabId);
    if (!session || session.state === 'DONE') return;
    if (screenText && typeof screenText === 'string') {
      session.buffer += '\n' + screenText;
      this.processBuffer(session);
    }
  }

  processBuffer(session) {
    const rawText = session.buffer;
    // Strip ANSI escape sequences and control codes for robust matching
    const text = rawText
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\([a-zA-Z]/g, '')
      .replace(/\x1b/g, '');

    // 0. Safety Emergency Brake: Check for login failure / wrong password
    // Prevent continuous retry loops that could lock the user's PTT account!
    if (session.state !== 'WAIT_USER' && session.state !== 'SENDING_USER') {
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
      if (/請輸入代號|請輸入帳號|請輸入使用者代號|login\s*[:：]|代號\s*[:：]|帳號\s*[:：]|guest.*參觀|new.*註冊/i.test(text)) {
        session.state = 'SENDING_USER';
        session.buffer = ''; // reset buffer for next stage
        clearTimeout(session.actionTimer);
        this.onStatusChange?.(session.tabId, `🔐 正在輸入帳號 (${session.username})...`);
        session.actionTimer = setTimeout(() => {
          // Step 1: Send username string
          session.sendData(session.username);
          // Step 2: Send Enter (\r) after delay so BBS input loop registers token + newline
          setTimeout(() => {
            session.sendData('\r');
            if (session.password) {
              session.state = 'WAIT_PASS';
              this.onStatusChange?.(session.tabId, '🔐 帳號已送出，等待密碼提示...');
            } else {
              session.state = 'DONE';
              this.onStatusChange?.(session.tabId, '已輸入帳號，請手動輸入密碼');
              setTimeout(() => this.stopSession(session.tabId), 3000);
            }
          }, 100);
        }, 120);
      }
    } else if (session.state === 'WAIT_PASS') {
      if (/請輸入密碼|password\s*[:：]|密碼\s*[:：]|您的密碼/i.test(text)) {
        session.state = 'SENDING_PASS';
        session.buffer = '';
        clearTimeout(session.actionTimer);
        this.onStatusChange?.(session.tabId, '🔐 正在輸入密碼...');
        session.actionTimer = setTimeout(() => {
          // Step 1: Send password string
          session.sendData(session.password);
          // Step 2: Send Enter (\r) after delay
          setTimeout(() => {
            session.sendData('\r');
            session.state = 'WAIT_ANYKEY';
            this.onStatusChange?.(session.tabId, '🔐 密碼已送出，等待確認畫面...');
          }, 100);
        }, 120);
      }
    } else if (session.state === 'WAIT_ANYKEY') {
      if (/您想刪除其他重複登入的連線嗎/i.test(text)) {
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          session.sendData('y\r');
        }, 100);
      } else if (/您要刪除以上錯誤嘗試的記錄嗎/i.test(text)) {
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          session.sendData('y\r');
        }, 100);
      } else if (/請按任意鍵|按任意鍵|請按\s*Enter|請按\s*SPACE|按\s*Enter/i.test(text)) {
        session.buffer = '';
        session.anyKeyCount++;
        clearTimeout(session.actionTimer);
        session.actionTimer = setTimeout(() => {
          session.sendData('\r');
          if (session.anyKeyCount >= 3) {
            session.state = 'DONE';
            this.onStatusChange?.(session.tabId, '自動登入完成');
            setTimeout(() => this.stopSession(session.tabId), 1000);
          }
        }, 100);
      } else if (/主功能表|休閒聊天|個人設定區|即時動態|分類看板/i.test(text)) {
        session.state = 'DONE';
        this.onStatusChange?.(session.tabId, '自動登入完成');
        setTimeout(() => this.stopSession(session.tabId), 1000);
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

