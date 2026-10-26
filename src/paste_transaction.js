// A single paste transaction owns its producer until all transport writes settle.
export class TerminalPasteTransaction {
  constructor({ getActiveTab, getTabById, getSession, send, confirm, onFailure, acquireInput, releaseInput, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), chunkSize = 256, delay = 25 }) {
    Object.assign(this, { getActiveTab, getTabById, getSession, send, confirm, onFailure, acquireInput, releaseInput, sleep, chunkSize, delay });
    this.busy = false;
    this.failedDraft = null;
    this.cancelled = false;
  }
  cancel() { this.cancelled = true; this.controller?.abort(); }
  async paste(input) {
    if (this.busy) return { status: 'busy' };
    const tab = this.getActiveTab();
    if (!tab?.isConnected) return { status: 'disconnected' };
    this.busy = true;
    this.cancelled = false;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    let inputLease;
    let remaining = '', uncertain = false;
    try {
      if (this.acquireInput) {
        inputLease = this.acquireInput(tab.id);
        if (!inputLease) return { status: 'busy' };
      }
      const session = await this.getSession(tab.id);
      if (this.cancelled) throw new Error('貼上已取消');
      const text = typeof input === 'function' ? await input({ signal }) : input;
      if (typeof text !== 'string' || !text) return { status: 'empty' };
      if (text.length > 30000) throw new Error('剪貼簿超過 30,000 字元，未送出');
      remaining = text.replace(/\r\n|\n/g, '\r');
      if (this.cancelled) throw new Error('貼上已取消');
      if (String(tab.address || '').toLowerCase().includes('ptt')) {
        remaining = remaining.replace(/\x1b\[/g, '\x15[').replace(/\*\[([0-9;]*m)/g, '\x15[$1');
      }
      const lines = remaining.split('\r');
      if (lines.length > 5 || remaining.length > 500) {
        if (!await this.confirm(lines.length, remaining.length, lines.slice(0, 4).join('\n'))) return { status: 'cancelled' };
      }
      while (remaining) {
        if (this.cancelled) throw new Error('貼上已取消');
        const currentSession = await this.getSession(tab.id);
        if (this.cancelled) throw new Error('貼上已取消');
        if (this.getTabById(tab.id) !== tab || !tab.isConnected || currentSession !== session) throw new Error('連線已變更，已停止貼上');
        // Bound single-line payloads too; never split a UTF-16 surrogate pair.
        let end = Math.min(this.chunkSize, remaining.length);
        const newline = remaining.indexOf('\r');
        if (newline >= 0 && newline < end) end = newline + 1;
        if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
        const chunk = remaining.slice(0, end);
        uncertain = true;
        await this.send(tab.id, chunk, session, inputLease, signal);
        uncertain = false;
        remaining = remaining.slice(end);
        if (remaining) await this.sleep(this.delay);
      }
      this.failedDraft = null;
      return { status: 'sent' };
    } catch (error) {
      // A failed write may have delivered a prefix. Preserve it, but never retry automatically.
      this.failedDraft = { tabId: tab.id, remaining, uncertain, error: error.message };
      this.onFailure?.(this.failedDraft);
      return { status: 'failed', ...this.failedDraft };
    } finally {
      try { if (inputLease) this.releaseInput?.(tab.id, inputLease); }
      finally { this.controller = null; this.busy = false; }
    }
  }
}
