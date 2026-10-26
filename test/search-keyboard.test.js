import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchWidget } from '../src/search.js';

// Exercise the listener installed by SearchWidget, not a copy of its dispatch logic.
function createSearch(t) {
  const originalDocument = globalThis.document;
  const elements = new Map();
  const element = () => ({
    listeners: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    value: '',
  });
  globalThis.document = {
    body: { appendChild() {} },
    createElement() {
      return { ...element(), querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      } };
    },
  };
  t.after(() => { globalThis.document = originalDocument; });
  const search = new SearchWidget(() => null);
  const calls = [];
  search.nextMatch = () => calls.push('next');
  search.prevMatch = () => calls.push('prev');
  search.close = () => calls.push('close');
  search.performSearch = () => calls.push('search');
  return { calls, search, dispatch(data) {
    const event = { prevented: false, stopped: false, ...data,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    search.inputEl.listeners.keydown(event);
    return event;
  } };
}

test('search IME confirmation and navigation keys during composition', t => {
  const { calls, dispatch } = createSearch(t);
  for (const key of ['Enter', 'F3']) {
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = dispatch({ key, ...composition });
      assert.equal(event.prevented, false);
      assert.equal(event.stopped, false);
    }
  }
  dispatch({ key: 'Process' });
  assert.deepEqual(calls, []);
});

test('search IME cancellation via Escape during composition reverts uncommitted text without closing search', t => {
  const { calls, search, dispatch } = createSearch(t);
  search.inputEl.value = 'pre-existing';
  search.inputEl.listeners.compositionstart();
  // Simulate typing uncommitted characters
  search.inputEl.value = 'pre-existing ㄨㄛ';

  calls.length = 0;
  // User presses Escape to cancel composition
  const event = dispatch({ key: 'Escape', isComposing: true });
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(search.inputEl.value, 'pre-existing'); // Must revert uncommitted text!
  assert.deepEqual(calls, ['search']); // Must update search with reverted text
  assert.equal(calls.includes('close'), false); // Must NOT close search widget!

  // Browser fires compositionend on cancelled composition
  search.inputEl.listeners.compositionend();
  assert.equal(search.inputEl.value, 'pre-existing'); // Still clean

  // Subsequent Escape outside composition cleanly closes search
  calls.length = 0;
  const nextEvent = dispatch({ key: 'Escape', isComposing: false, keyCode: 27 });
  assert.equal(nextEvent.prevented, true);
  assert.equal(nextEvent.stopped, true);
  assert.deepEqual(calls, ['close']); // Search widget cleanly closed!
});

test('search IME cancellation via Escape after compositionend does not close search', t => {
  const { calls, search, dispatch } = createSearch(t);
  search.inputEl.value = '';
  // Simulate composition session ending via Escape
  search.inputEl.listeners.compositionstart();
  search.inputEl.value = 'ㄨ';
  search.inputEl.listeners.compositionend();
  calls.length = 0;
  // Chrome fires keydown with key: 'Escape', isComposing: false, keyCode: 27
  const event = dispatch({ key: 'Escape', isComposing: false, keyCode: 27 });
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(search.inputEl.value, ''); // Reverts uncommitted text
  assert.equal(calls.includes('close'), false); // Search widget must NOT be closed!

  // Subsequent Escape outside composition cleanly closes search
  calls.length = 0;
  const nextEvent = dispatch({ key: 'Escape', isComposing: false, keyCode: 27 });
  assert.equal(nextEvent.prevented, true);
  assert.equal(nextEvent.stopped, true);
  assert.deepEqual(calls, ['close']); // Search widget cleanly closed!
});

test('search navigation fires once and stops bubbling outside composition', t => {
  const { calls, dispatch } = createSearch(t);
  for (const [key, shiftKey, action] of [
    ['Enter', false, 'next'], ['Enter', true, 'prev'],
    ['F3', false, 'next'], ['F3', true, 'prev'], ['Escape', false, 'close'],
  ]) {
    calls.length = 0;
    const event = dispatch({ key, shiftKey });
    assert.deepEqual(calls, [action]);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  }
});

test('search input event suppresses performSearch during composition and updates on commit', t => {
  const { calls, search } = createSearch(t);

  // 1. Normal input outside composition triggers search immediately
  calls.length = 0;
  search.inputEl.listeners.input({ isComposing: false });
  assert.deepEqual(calls, ['search']);

  // 2. Composition starts (typing Bopomofo / Zhuyin)
  calls.length = 0;
  search.inputEl.listeners.compositionstart();
  search.inputEl.listeners.input({ isComposing: true });
  search.inputEl.listeners.compositionupdate();
  search.inputEl.listeners.input(); // Without explicit event param
  assert.deepEqual(calls, []); // Must NOT perform search or touch DOM while composing!

  // 3. Syllable completed, candidate chosen or confirmed (compositionend)
  search.inputEl.listeners.compositionend();
  assert.deepEqual(calls, ['search']); // Must perform search upon final character commit!
});
