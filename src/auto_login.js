// Auto-Login Controller for BBS Sessions (PTT / MapleBBS / Bahamut)

const OTP_PROMPT_REGEX = /請輸入動態驗證碼|請輸入兩階段.*驗證碼|2FA.*驗證碼|兩階段.*驗證碼|動態驗證碼/i;
const OTP_ERROR_REGEX = /驗證碼錯誤|驗證碼輸入錯誤|驗證失敗|2FA.*(?:錯誤|失敗)|無效的驗證碼/i;
const POST_LOGIN_SCREEN_REGEX = /您想刪除其他重複登入的連線嗎|您要刪除以上錯誤嘗試的記錄嗎|歡迎您再度拜訪|歡迎.*拜訪|上次您是在|主功能表|休閒聊天|個人設定區|即時動態|分類看板/i;

export class AutoLoginManager {
  constructor() {
    this.sessions = new Map(); // tabId -> AutoLoginSession
    this.onStatusChange = null;
    this.onLoginError = null;
  }

  startSession(tabId, credentials, sendDataFn, initialBufferText = '', options = {}) {
    if (!credentials || !credentials.username) {
      return;
    }

    this.stopSession(tabId);

    const session = {
      tabId,
      username: credentials.username,
      password: credentials.password || '',
      otpCode: typeof credentials.otpCode === 'string' ? credentials.otpCode.trim() : '',
      sendData: (data) => sendDataFn(data, session.abortController.signal),
      sendOtp: options.sendOtp,
      abortController: new AbortController(),
      state: 'WAIT_USER',
      buffer: initialBufferText || '',
      anyKeyCount: 0,
      handledDuplicatePrompt: false,
      handledErrorRecordsPrompt: false,
      otpSent: false,
      timeoutTimer: null,
      actionTimer: null,
      timers: new Set(),
    };

    // Safety timeout: auto cancel after 25 seconds
    this.sessions.set(tabId, session);
    session.timeoutTimer = this.schedule(session, () => {
      this.stopSession(tabId);
    }, 25000);

    this.onStatusChange?.(tabId, '🔐 正在自動登入...');

    // If initial buffer already has login prompt, process immediately
    if (session.buffer) {
      this.processBuffer(session);
    }
  }

  schedule(session, callback, delay) {
    const timer = setTimeout(() => {
      session.timers.delete(timer);
      if (this.sessions.get(session.tabId) === session) callback();
    }, delay);
    session.timers.add(timer);
    return timer;
  }

  hasActiveSession(tabId) {
    const session = this.sessions.get(tabId);
    return Boolean(session && session.state !== 'DONE');
  }

  feedData(tabId, data) {
    const session = this.sessions.get(tabId);
    if (!session || session.state === 'DONE') return;

    const chunk = typeof data === 'string' ? data : '';
    if (session.state === 'WAIT_2FA' || session.state === 'SENDING_2FA') {
      session.buffer = (session.buffer + chunk).slice(-2048);
      this.processBuffer(session);
      return;
    }
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
      if (session.state === 'WAIT_2FA' || session.state === 'SENDING_2FA') {
        if (session.state === 'SENDING_2FA') session.latestOtpScreen = screenText;
        this.processBuffer(session, screenText, true);
        return;
      }
      session.buffer += '\n' + screenText;
      if (session.buffer.length > 4096) session.buffer = session.buffer.slice(-2048);
      this.processBuffer(session);
    }
  }

  processBuffer(session, rawText = session.buffer, currentScreen = false) {
    // Strip ANSI escape sequences and control codes for robust matching
    const text = rawText
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\([a-zA-Z]/g, '')
      .replace(/\x1b/g, '');

    // 0. Safety Emergency Brake: Check for login failure / wrong password
    // Prevent continuous retry loops that could lock the user's PTT account!
    if (session.state !== 'WAIT_USER' && session.state !== 'SENDING_USER') {
      if (/密碼不對|密碼錯誤|無此帳號|密碼嘗試錯誤|密碼輸入錯誤|請重新輸入密碼|嘗試次數過多/i.test(text) || OTP_ERROR_REGEX.test(text)) {
        const otpFailure = session.state === 'WAIT_2FA' || OTP_ERROR_REGEX.test(text);
        session.state = 'FAILED';
        clearTimeout(session.actionTimer);
        clearTimeout(session.timeoutTimer);
        this.onStatusChange?.(session.tabId, otpFailure ? '❌ 驗證失敗，已停止自動登入' : '❌ 登入失敗，已停止自動登入');
        this.onLoginError?.(session.tabId, otpFailure
          ? '偵測到驗證失敗，已停止自動登入；請檢查後手動處理。'
          : '偵測到密碼錯誤或無此帳號，已停止自動登入；請檢查後手動處理。');
        this.stopSession(session.tabId);
        return;
      }
    }

    // Do not let generic "any key" handling type into an OTP prompt.
    if (session.state === 'WAIT_ANYKEY' && OTP_PROMPT_REGEX.test(text)) {
      clearTimeout(session.actionTimer);
      clearTimeout(session.timeoutTimer);
      session.buffer = '';
      if (session.otpCode && !session.otpSent && session.sendOtp) {
        session.otpSent = true;
        session.state = 'SENDING_2FA';
        this.onStatusChange?.(session.tabId, '🔐 正在填入 2FA 動態驗證碼...');
        session.actionTimer = this.schedule(session, async () => {
          let code = session.otpCode;
          session.otpCode = '';
          try {
            await session.sendOtp(code, session.abortController.signal);
            code = '';
            if (this.sessions.get(session.tabId) !== session || session.state !== 'SENDING_2FA') return;
            session.state = 'WAIT_2FA';
            this.onStatusChange?.(session.tabId, '🔐 動態驗證碼已送出，等待確認畫面...');
            if (session.latestOtpScreen) this.processBuffer(session, session.latestOtpScreen, true);
          } catch {
            code = '';
            if (this.sessions.get(session.tabId) !== session) return;
            this.onLoginError?.(session.tabId, '動態驗證碼傳送失敗或結果不明，已停止自動登入，請手動檢查。');
            this.stopSession(session.tabId);
          }
        }, 120);
        return;
      }
      session.otpCode = '';
      session.state = 'WAIT_2FA';
      this.onStatusChange?.(session.tabId, '🔐 請在終端手動輸入動態驗證碼');
      return;
    }

    if (session.state === 'WAIT_2FA') {
      // Only a current screen with an unambiguous post-login prompt can resume
      // automation. A repeated OTP prompt or an arbitrary key prompt is not proof.
      if (!currentScreen || OTP_PROMPT_REGEX.test(text)) return;
      if (!POST_LOGIN_SCREEN_REGEX.test(text)) return;
      session.buffer = text;
      session.state = 'WAIT_ANYKEY';
    }

    if (session.state === 'SENDING_2FA') return;

    if (session.state === 'WAIT_USER') {
      const promptTypes = [
        /請輸入代號|請輸入帳號|請輸入使用者代號|login\s*[:：]|代號\s*[:：]|帳號\s*[:：]|guest.*參觀|new.*註冊/i,
        /請輸入密碼|password\s*[:：]|密碼\s*[:：]|您的密碼/i,
        OTP_PROMPT_REGEX,
      ];
      if (promptTypes.filter(pattern => pattern.test(text)).length > 1) {
        this.onLoginError?.(session.tabId, '登入畫面包含多個提示，已停止自動登入，請手動處理。');
        this.stopSession(session.tabId);
        return;
      }
      if (promptTypes[0].test(text)) {
        session.state = 'SENDING_USER';
        session.buffer = ''; // reset buffer for next stage
        clearTimeout(session.actionTimer);
        this.onStatusChange?.(session.tabId, `🔐 正在輸入帳號 (${session.username})...`);
        session.actionTimer = this.schedule(session, () => {
          // Step 1: Send username string
          session.sendData(session.username);
          // Step 2: Send Enter (\r) after delay so BBS input loop registers token + newline
          this.schedule(session, () => {
            session.sendData('\r');
            if (session.password) {
              session.state = 'WAIT_PASS';
              this.onStatusChange?.(session.tabId, '🔐 帳號已送出，等待密碼提示...');
            } else {
              session.state = 'DONE';
              this.onStatusChange?.(session.tabId, '已輸入帳號，請手動輸入密碼');
              this.schedule(session, () => this.stopSession(session.tabId), 3000);
            }
          }, 100);
        }, 120);
      } else if (/請輸入密碼|password\s*[:：]|密碼\s*[:：]|您的密碼/i.test(text)) {
        // Fast-forward directly to password prompt if already past username
        session.state = 'WAIT_PASS';
        this.processBuffer(session, text, currentScreen);
        return;
      } else if (OTP_PROMPT_REGEX.test(text)) {
        // Fast-forward directly to 2FA prompt if already past password
        session.state = 'WAIT_ANYKEY';
        this.processBuffer(session, text, currentScreen);
        return;
      }
    } else if (session.state === 'WAIT_PASS') {
      if (/請輸入密碼|password\s*[:：]|密碼\s*[:：]|您的密碼/i.test(text)) {
        session.state = 'SENDING_PASS';
        session.buffer = '';
        clearTimeout(session.actionTimer);
        this.onStatusChange?.(session.tabId, '🔐 正在輸入密碼...');
        session.actionTimer = this.schedule(session, () => {
          // Step 1: Send password string
          const password = session.password;
          session.password = '';
          session.sendData(password);
          // Step 2: Send Enter (\r) after delay
          this.schedule(session, () => {
            session.state = 'WAIT_ANYKEY';
            session.sendData('\r');
            this.onStatusChange?.(session.tabId, '🔐 密碼已送出，等待確認畫面...');
            this.processBuffer(session);
          }, 100);
        }, 120);
      }
    } else if (session.state === 'WAIT_ANYKEY') {
      if (/您想刪除其他重複登入的連線嗎/i.test(text)) {
        if (session.handledDuplicatePrompt) return;
        session.handledDuplicatePrompt = true;
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = this.schedule(session, () => {
          session.sendData('y\r');
        }, 100);
      } else if (/您要刪除以上錯誤嘗試的記錄嗎/i.test(text)) {
        if (session.handledErrorRecordsPrompt) return;
        session.handledErrorRecordsPrompt = true;
        session.buffer = '';
        clearTimeout(session.actionTimer);
        session.actionTimer = this.schedule(session, () => {
          session.sendData('y\r');
        }, 100);
      } else if (/請按任意鍵|按任意鍵|請按\s*Enter|請按\s*SPACE|按\s*Enter/i.test(text)) {
        session.buffer = '';
        session.anyKeyCount++;
        clearTimeout(session.actionTimer);
        session.actionTimer = this.schedule(session, () => {
          session.sendData('\r');
          if (session.anyKeyCount >= 3) {
            session.state = 'DONE';
            this.onStatusChange?.(session.tabId, '自動登入完成');
            this.schedule(session, () => this.stopSession(session.tabId), 1000);
          }
        }, 100);
      } else if (/主功能表|休閒聊天|個人設定區|即時動態|分類看板/i.test(text)) {
        session.state = 'DONE';
        this.onStatusChange?.(session.tabId, '自動登入完成');
        this.schedule(session, () => this.stopSession(session.tabId), 1000);
      }
    }
  }

  stopSession(tabId) {
    const session = this.sessions.get(tabId);
    if (session) {
      session.abortController.abort();
      session.password = '';
      session.otpCode = '';
      clearTimeout(session.timeoutTimer);
      clearTimeout(session.actionTimer);
      for (const timer of session.timers) clearTimeout(timer);
      session.timers.clear();
      this.sessions.delete(tabId);
    }
  }
}

export const autoLoginManager = new AutoLoginManager();
