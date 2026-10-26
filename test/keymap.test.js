import test from 'node:test';
import assert from 'node:assert/strict';
import { translateBbsKey, isInteractiveInputElement, isMac } from '../src/keymap.js';

test('translateBbsKey recognizes Ctrl+V as paste command', () => {
  const event = {
    code: 'KeyV',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  const result = translateBbsKey(event);
  assert.equal(result.isPaste, true);
  assert.equal(result.handled, false);
});

test('translateBbsKey recognizes Shift+Insert as paste command on Windows/Linux', () => {
  const event = {
    code: 'Insert',
    key: 'Insert',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: true,
  };
  const result = translateBbsKey(event);
  assert.equal(result.isPaste, true);
  assert.equal(result.handled, false);
});

test('translateBbsKey recognizes Cmd+V as paste command on macOS', () => {
  if (isMac) {
    const event = {
      code: 'KeyV',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: false,
    };
    const result = translateBbsKey(event);
    assert.equal(result.isPaste, true);
    assert.equal(result.handled, false);
  }
});

test('translateBbsKey translates navigation and editing keys correctly', () => {
  assert.deepEqual(translateBbsKey({ key: 'Enter', code: 'Enter' }), { seq: '\r', handled: true });
  assert.deepEqual(translateBbsKey({ key: 'Escape', code: 'Escape' }), { seq: '\x1b', handled: true });
  assert.deepEqual(translateBbsKey({ key: 'ArrowUp', code: 'ArrowUp' }), { seq: '\x1bOA', handled: true });
  assert.deepEqual(translateBbsKey({ key: 'ArrowDown', code: 'ArrowDown' }), { seq: '\x1bOB', handled: true });
  assert.deepEqual(translateBbsKey({ key: 'ArrowLeft', code: 'ArrowLeft' }), { seq: '\x1b[D', handled: true });
  assert.deepEqual(translateBbsKey({ key: 'ArrowRight', code: 'ArrowRight' }), { seq: '\x1b[C', handled: true });
});

test('translateBbsKey sends two backspaces for DBCS trail byte when smartDbcsBackspace is enabled', () => {
  const result = translateBbsKey(
    { key: 'Backspace', code: 'Backspace' },
    { smartDbcsBackspace: true, isPrevCharDBCS: true }
  );
  assert.equal(result.seq, '\x08\x08');
  assert.equal(result.handled, true);
});

test('isInteractiveInputElement identifies input and textarea elements', () => {
  assert.equal(isInteractiveInputElement({ tagName: 'INPUT' }), true);
  assert.equal(isInteractiveInputElement({ tagName: 'TEXTAREA' }), true);
  assert.equal(isInteractiveInputElement({ tagName: 'DIV' }), false);
  const imeEl = { tagName: 'TEXTAREA' };
  assert.equal(isInteractiveInputElement(imeEl, imeEl), false);
});

test('translateBbsKey preserves essential BBS control codes without hijacking on Windows/Linux', () => {
  // Ctrl+P (PTT Post Article -> ASCII 16 \x10)
  assert.deepEqual(translateBbsKey({ code: 'KeyP', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), { seq: '\x10', handled: true });
  // Ctrl+X (PTT Save & Submit -> ASCII 24 \x18)
  assert.deepEqual(translateBbsKey({ code: 'KeyX', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), { seq: '\x18', handled: true });
  // Ctrl+U (PTT User List -> ASCII 21 \x15)
  assert.deepEqual(translateBbsKey({ code: 'KeyU', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), { seq: '\x15', handled: true });
  // Ctrl+W (PTT Waterball Reply -> ASCII 23 \x17)
  assert.deepEqual(translateBbsKey({ code: 'KeyW', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), { seq: '\x17', handled: true });
  // Ctrl+C (BBS Break / Cancel -> ASCII 3 \x03)
  assert.deepEqual(translateBbsKey({ code: 'KeyC', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), { seq: '\x03', handled: true });
});

test('translateBbsKey maps Alt+R/T/W/A to BBS control codes for term.ptt.cc parity', () => {
  // Alt+R -> Ctrl+R (0x12, PTT Waterball reply)
  assert.deepEqual(translateBbsKey({ code: 'KeyR', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }), { seq: '\x12', handled: true });
  // Alt+T -> Ctrl+T (0x14)
  assert.deepEqual(translateBbsKey({ code: 'KeyT', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }), { seq: '\x14', handled: true });
  // Alt+W -> Ctrl+W (0x17)
  assert.deepEqual(translateBbsKey({ code: 'KeyW', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }), { seq: '\x17', handled: true });
  // Alt+A -> Ctrl+A (0x01)
  assert.deepEqual(translateBbsKey({ code: 'KeyA', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }), { seq: '\x01', handled: true });
});

test('Alt control fallbacks reject AltGr and extra modifiers on Windows and Mac', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../src/keymap.js', import.meta.url), 'utf8').replace(/export /g, '');
  for (const platform of ['Win32', 'Linux x86_64', 'MacIntel']) {
    const context = { navigator: { platform } };
    runInNewContext(source + '\nthis.translate = translateBbsKey;', context);
    for (const [code, seq] of [['KeyR', '\x12'], ['KeyT', '\x14'], ['KeyW', '\x17'], ['KeyA', '\x01']]) {
      const base = { code, key: code[3].toLowerCase(), altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
      assert.equal(context.translate(base).seq, seq, platform);
      for (const modifiers of [
        { ctrlKey: true }, { ctrlKey: true, shiftKey: true },
        { shiftKey: true }, { metaKey: true },
        { getModifierState: name => name === 'AltGraph' },
        { ctrlKey: true, shiftKey: true, getModifierState: name => name === 'AltGraph' },
      ]) {
        const result = context.translate({ ...base, ...modifiers });
        assert.equal(result.seq, '', `${platform}: ${code}`);
        assert.equal(result.handled, false);
      }
    }
    for (const [code, seq] of [['KeyT', '\x14'], ['KeyW', '\x17']]) {
      assert.equal(context.translate({ code, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }).seq, seq);
    }
  }
});
