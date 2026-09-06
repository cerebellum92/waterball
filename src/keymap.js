// Cross-Platform BBS & Window Shortcut Keymap Dispatcher for bbsterm

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/**
 * Checks whether the currently focused element is an interactive input
 * that should NOT be intercepted by BBS keymaps.
 */
export function isInteractiveInputElement(el, imeInput = null) {
  if (!el) return false;
  if (el === imeInput) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'SELECT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable
  );
}

/**
 * Translates a keyboard event into BBS ANSI escape sequences or control codes.
 * Returns { seq: string, handled: boolean, isPaste?: boolean }
 */
export function translateBbsKey(e, { smartDbcsBackspace = true, isPrevCharDBCS = false, isCurCharDBCSLead = false } = {}) {
  // Let CapsLock switch IME without sending keycodes
  if (e.code === 'CapsLock') {
    return { seq: '', handled: true };
  }

  // Pure Ctrl (on Mac: pure Ctrl+A..Z; on Win/Linux: Ctrl without Shift)
  const isCtrl = isMac ? e.ctrlKey : (e.ctrlKey && !e.shiftKey);
  let seq = '';

  if (isCtrl && !e.altKey) {
    if (e.code.startsWith('Key')) {
      const letter = e.code.charAt(3).toUpperCase();
      const code = letter.charCodeAt(0) - 64; // 'A' (65) -> 1, 'Z' (90) -> 26
      if (code >= 1 && code <= 26) {
        if (letter === 'V') {
          return { seq: '', handled: false, isPaste: true }; // Let browser paste event handle
        }
        seq = String.fromCharCode(code);
      }
    } else if (e.code === 'BracketLeft') {
      seq = '\x1b'; // Ctrl+[ (ESC)
    } else if (e.code === 'BracketRight') {
      seq = '\x1d'; // Ctrl+]
    } else if (e.code === 'Backslash') {
      seq = '\x1c'; // Ctrl+\
    } else if (e.code === 'Slash' || e.code === 'Minus') {
      seq = '\x1f'; // Ctrl+/ or Ctrl+_
    } else if (e.code === 'Digit2') {
      seq = '\x00'; // Ctrl+@ (NUL)
    } else if (e.key === 'ArrowLeft') {
      seq = e.metaKey ? '\x1b[1~' : '\x1b[1;5D'; // Cmd+Left -> Home, Ctrl+Left -> Word Left
    } else if (e.key === 'ArrowRight') {
      seq = e.metaKey ? '\x1b[4~' : '\x1b[1;5C'; // Cmd+Right -> End, Ctrl+Right -> Word Right
    } else if (e.key === 'ArrowUp') {
      seq = e.metaKey ? '\x1b[1~' : '\x1b[1;5A'; // Cmd+Up -> Home
    } else if (e.key === 'ArrowDown') {
      seq = e.metaKey ? '\x1b[4~' : '\x1b[1;5B'; // Cmd+Down -> End
    } else if (e.key === 'Letter' || (e.key.length === 1 && e.key.toLowerCase() >= 'a' && e.key.toLowerCase() <= 'z')) {
      const code = e.key.toLowerCase().charCodeAt(0) - 96;
      seq = String.fromCharCode(code);
    }
  } else if (e.altKey && !isCtrl) {
    // Alt / Option Key Combinations (ESC prefix)
    if (e.key.length === 1) {
      seq = '\x1b' + e.key;
    }
  } else if (!isCtrl && !e.altKey) {
    // Shift Key Modifiers for Navigation
    if (e.shiftKey) {
      switch (e.key) {
        case 'Tab': seq = '\x1b[Z'; break; // Shift+Tab
        case 'ArrowUp': seq = '\x1b[5~'; break; // Shift+Up -> PageUp
        case 'ArrowDown': seq = '\x1b[6~'; break; // Shift+Down -> PageDown
        case 'ArrowLeft': seq = '\x1b[1~'; break; // Shift+Left -> Home
        case 'ArrowRight': seq = '\x1b[4~'; break; // Shift+Right -> End
      }
    }

    // Standard Navigation, BBS Function, and Editing keys
    if (!seq) {
      switch (e.key) {
        case 'ArrowUp': seq = '\x1b[A'; break;
        case 'ArrowDown': seq = '\x1b[B'; break;
        case 'ArrowRight': seq = '\x1b[C'; break;
        case 'ArrowLeft': seq = '\x1b[D'; break;
        case 'Enter': seq = '\r'; break;
        case 'Backspace':
          // Smart DBCS Backspace: if left cell is DBCS trail byte, send 2 Backspaces (\x08\x08)
          seq = (smartDbcsBackspace && isPrevCharDBCS) ? '\x08\x08' : '\x08';
          break;
        case 'Escape': seq = '\x1b'; break;
        case 'Tab': seq = '\t'; break;
        case 'PageUp': seq = '\x1b[5~'; break;
        case 'PageDown': seq = '\x1b[6~'; break;
        case 'Home': seq = '\x1b[1~'; break;
        case 'End': seq = '\x1b[4~'; break;
        case 'Insert': seq = '\x1b[2~'; break;
        case 'Delete':
          // Smart DBCS Delete: if current cell is DBCS lead byte, send 2 Deletes
          seq = (smartDbcsBackspace && isCurCharDBCSLead) ? '\x1b[3~\x1b[3~' : '\x1b[3~';
          break;
        case 'F1': seq = '\x1bOP'; break;
        case 'F2': seq = '\x1bOQ'; break;
        case 'F3': seq = '\x1bOR'; break;
        case 'F4': seq = '\x1bOS'; break;
        case 'F5': seq = '\x1b[15~'; break;
        case 'F6': seq = '\x1b[17~'; break;
        case 'F7': seq = '\x1b[18~'; break;
        case 'F8': seq = '\x1b[19~'; break;
        case 'F9': seq = '\x1b[20~'; break;
        case 'F10': seq = '\x1b[21~'; break;
        case 'F11': seq = '\x1b[23~'; break;
        case 'F12': seq = '\x1b[24~'; break;
      }
    }
  }

  return { seq, handled: Boolean(seq) };
}
