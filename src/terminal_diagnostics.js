const isDevelopment = import.meta.env?.DEV ?? false;

class TerminalDiagnostics {
  constructor() {
    this.enabled = false;
    this.pendingNavigation = null;
    this.dataStats = null;
    this.flushTimer = null;
    this.lastDataAt = null;
    this.dataAwaitingFrame = false;
    this.captureEnabled = false;
    this.captureAutoFreeze = true;
    this.lastCapture = '';
    this.captureStartedAt = null;
    this.captureSequence = 0;
    this.captureEvents = [];
    this.captureFrozenAtMs = null;
    this.captureFrozenReason = null;
    this.captureFrozenDetails = null;
  }

  install() {
    if (!isDevelopment) return;
    window.waterballDiagnostics = {
      start: () => this.start(),
      stop: () => this.stop(),
      captureStart: (options) => this.captureStart(options),
      captureStop: () => this.captureStop(),
      captureFreeze: () => this.freezeCapture('manual'),
      captureSave: () => this.captureSave(),
    };
  }

  start() {
    if (!isDevelopment) return;
    this.enabled = true;
    this.resetDataStats();
    console.info('[Waterball diagnostics] enabled; terminal content and key values are not recorded.');
  }

  stop() {
    if (!isDevelopment || !this.enabled) return;
    this.flushDataStats();
    this.finishNavigation('diagnostics-stopped');
    this.enabled = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    console.info('[Waterball diagnostics] disabled.');
  }

  resetDataStats() {
    this.dataStats = {
      events: 0,
      rawBytes: 0,
      decodedChars: 0,
      rustToFrontendMsTotal: 0,
      rustToFrontendMsMax: 0,
      readToEmitMsTotal: 0,
      readToFrontendMsTotal: 0,
      parserMsTotal: 0,
      parserMsMax: 0,
      renders: 0,
      scheduledToFrameMsTotal: 0,
      scheduledToFrameMsMax: 0,
      dataToFrameMsTotal: 0,
      dataToFrameSamples: 0,
      redrawMsTotal: 0,
      redrawMsMax: 0,
    };
  }

  async captureStart({ autoFreeze = true } = {}) {
    if (!isDevelopment) return;
    await window.__TAURI__.core.invoke('set_raw_terminal_capture', { enabled: true });
    this.captureEnabled = true;
    this.captureAutoFreeze = autoFreeze;
    this.lastCapture = '';
    window.waterballCapture = '';
    this.captureStartedAt = performance.now();
    this.captureSequence = 0;
    this.captureEvents = [];
    this.captureFrozenAtMs = null;
    this.captureFrozenReason = null;
    this.captureFrozenDetails = null;
    console.info('[Waterball diagnostics] raw terminal capture armed; captured screen text may be sensitive.');
  }

  async captureStop() {
    if (!isDevelopment || !this.captureEnabled) return this.lastCapture;
    this.captureEnabled = false;
    window.__TAURI__.core.invoke('set_raw_terminal_capture', { enabled: false }).catch(console.error);
    const capture = {
      durationMs: Math.round(performance.now() - this.captureStartedAt),
      frozenAtMs: this.captureFrozenAtMs,
      frozenReason: this.captureFrozenReason,
      frozenDetails: this.captureFrozenDetails,
      events: this.captureEvents,
    };
    this.captureEvents = [];
    this.captureStartedAt = null;
    this.captureFrozenAtMs = null;
    this.captureFrozenReason = null;
    this.captureFrozenDetails = null;
    this.lastCapture = JSON.stringify(capture);
    window.waterballCapture = this.lastCapture;
    console.info('[Waterball diagnostics] capture saved:', this.lastCapture.length, 'characters');
    return this.lastCapture;
  }

  async captureSave() {
    const capture = await this.captureStop();
    if (!capture) {
      console.warn('[Waterball diagnostics] no capture to save');
      return null;
    }
    const filename = `waterball-capture-${Date.now()}.json`;
    const url = URL.createObjectURL(new Blob([capture], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    console.info('[Waterball diagnostics] download requested:', filename);
    return filename;
  }

  freezeCapture(reason, details = {}) {
    if (!this.captureEnabled || this.captureFrozenAtMs !== null) return;
    if (!this.captureAutoFreeze && reason !== 'manual') {
      this.recordCapture('anomaly', { reason, ...details });
      return;
    }
    this.captureFrozenAtMs = Math.round(performance.now() - this.captureStartedAt);
    this.captureFrozenReason = reason;
    this.captureFrozenDetails = details;
    window.__TAURI__.core.invoke('set_raw_terminal_capture', { enabled: false }).catch(console.error);
    console.info('[Waterball diagnostics] capture frozen:', reason);
  }

  recordCapture(type, details) {
    if (!this.captureEnabled || this.captureFrozenAtMs !== null) return;
    const now = performance.now();
    this.captureEvents.push({
      sequence: ++this.captureSequence,
      elapsedMs: Math.round(now - this.captureStartedAt),
      type,
      ...details,
    });
    const cutoff = now - 30000;
    while (this.captureEvents.length && this.captureEvents[0].elapsedMs < cutoff - this.captureStartedAt) {
      this.captureEvents.shift();
    }
    if (this.captureEvents.length > 2000) this.captureEvents.shift();
  }

  recordInput({ tabId, data, sourceKey, isRepeat }) {
    this.recordCapture('input', { tabId, data, sourceKey, isRepeat: !!isRepeat });
  }

  recordRawRead({ tab_id: tabId, read_seq: readSeq, raw_hex: rawHex }) {
    this.recordCapture('rawRead', { tabId, readSeq, rawHex });
  }

  getColoredCells(buffer) {
    if (!this.captureEnabled || this.captureFrozenAtMs !== null || !buffer) return null;
    const backgrounds = [];
    const blocks = [];
    for (let row = 0; row < buffer.rows; row++) {
      let span = null;
      for (let col = 0; col < buffer.cols; col++) {
        const cell = buffer.lines[row][col];
        const background = cell.getBg();
        if (background !== 0) {
          if (span && span.background === background && span.end === col) {
            span.end++;
          } else {
            span = { row, start: col, end: col + 1, background };
            backgrounds.push(span);
          }
        } else {
          span = null;
        }
        if ('█▀▄▌▐'.includes(cell.ch) && cell.ch) {
          blocks.push({ row, col, char: cell.ch, foreground: cell.getFg(), background });
        }
      }
    }
    return { backgrounds, blocks };
  }

  startNavigation(keyType) {
    if (!this.enabled) return;
    this.finishNavigation('superseded');
    this.pendingNavigation = {
      keyType,
      startedAt: performance.now(),
      firstDataMs: null,
      dataEvents: 0,
      rawBytes: 0,
      decodedChars: 0,
    };
  }

  recordData({ tabId, data, rawReadSeq, cursorBefore, cursorAfter, bufferScreen, buffer, rawBytes, decodedChars, rustToFrontendMs, readToEmitMs, readToFrontendMs, parserMs }) {
    this.recordCapture('output', { tabId, data, rawReadSeq, cursorBefore, cursorAfter, bufferScreen, coloredCells: this.getColoredCells(buffer) });
    if (!this.enabled) return;
    if (!this.dataStats) this.resetDataStats();
    const stats = this.dataStats;
    this.lastDataAt = performance.now();
    this.dataAwaitingFrame = true;
    stats.events++;
    stats.rawBytes += rawBytes || 0;
    stats.decodedChars += decodedChars || 0;
    if (Number.isFinite(rustToFrontendMs)) {
      stats.rustToFrontendMsTotal += rustToFrontendMs;
      stats.rustToFrontendMsMax = Math.max(stats.rustToFrontendMsMax, rustToFrontendMs);
    }
    if (Number.isFinite(readToEmitMs)) stats.readToEmitMsTotal += readToEmitMs;
    if (Number.isFinite(readToFrontendMs)) stats.readToFrontendMsTotal += readToFrontendMs;
    stats.parserMsTotal += parserMs || 0;
    stats.parserMsMax = Math.max(stats.parserMsMax, parserMs || 0);

    const navigation = this.pendingNavigation;
    if (navigation) {
      if (navigation.firstDataMs === null) {
        navigation.firstDataMs = performance.now() - navigation.startedAt;
      }
      navigation.dataEvents++;
      navigation.rawBytes += rawBytes || 0;
      navigation.decodedChars += decodedChars || 0;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushDataStats();
      }, 2000);
    }
  }

  recordRender({ scheduledToFrameMs, redrawMs }) {
    if (!this.enabled) return;
    if (!this.dataStats) this.resetDataStats();
    const stats = this.dataStats;
    stats.renders++;
    stats.scheduledToFrameMsTotal += scheduledToFrameMs;
    stats.scheduledToFrameMsMax = Math.max(stats.scheduledToFrameMsMax, scheduledToFrameMs);
    stats.redrawMsTotal += redrawMs;
    stats.redrawMsMax = Math.max(stats.redrawMsMax, redrawMs);
    if (this.dataAwaitingFrame && this.lastDataAt !== null) {
      stats.dataToFrameMsTotal += performance.now() - this.lastDataAt;
      stats.dataToFrameSamples++;
      this.dataAwaitingFrame = false;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushDataStats();
      }, 2000);
    }
  }

  finishNavigation(reason) {
    const navigation = this.pendingNavigation;
    if (!this.enabled || !navigation) return;
    this.pendingNavigation = null;
    console.info('[Waterball diagnostics] navigation', {
      keyType: navigation.keyType,
      firstDataMs: navigation.firstDataMs,
      completionMs: performance.now() - navigation.startedAt,
      completionReason: reason,
      responseEvents: navigation.dataEvents,
      responseRawBytes: navigation.rawBytes,
      responseDecodedChars: navigation.decodedChars,
    });
  }

  flushDataStats() {
    const stats = this.dataStats;
    if (!this.enabled || !stats || (stats.events === 0 && stats.renders === 0)) return;
    this.dataStats = null;
    console.info('[Waterball diagnostics] terminal data batch', {
      events: stats.events,
      rawBytes: stats.rawBytes,
      decodedChars: stats.decodedChars,
      rustToFrontendMsAvg: stats.events ? stats.rustToFrontendMsTotal / stats.events : null,
      rustToFrontendMsMax: stats.rustToFrontendMsMax,
      readToEmitMsAvg: stats.events ? stats.readToEmitMsTotal / stats.events : null,
      readToFrontendMsAvg: stats.events ? stats.readToFrontendMsTotal / stats.events : null,
      parserMsAvg: stats.events ? stats.parserMsTotal / stats.events : null,
      parserMsMax: stats.parserMsMax,
      renders: stats.renders,
      scheduledToFrameMsAvg: stats.renders ? stats.scheduledToFrameMsTotal / stats.renders : null,
      scheduledToFrameMsMax: stats.scheduledToFrameMsMax,
      lastDataToFrameSamples: stats.dataToFrameSamples,
      lastDataToFrameMsAvg: stats.dataToFrameSamples
        ? stats.dataToFrameMsTotal / stats.dataToFrameSamples : null,
      redrawMsAvg: stats.renders ? stats.redrawMsTotal / stats.renders : null,
      redrawMsMax: stats.redrawMsMax,
    });
  }
}

export const terminalDiagnostics = new TerminalDiagnostics();
