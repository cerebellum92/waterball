import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalPasteTransaction } from '../src/paste_transaction.js';
function fixture(overrides = {}) {
  const tab = { id: 'tab', isConnected: true, address: 'ptt.cc' };
  const calls = [], delays = [], failures = [];
  let session = '1';
  const paste = new TerminalPasteTransaction({ getActiveTab: () => tab, getTabById: () => tab,
    getSession: async () => session, send: async (...args) => calls.push(args),
    confirm: async () => true, onFailure: draft => failures.push(draft), sleep: async ms => delays.push(ms), ...overrides });
  return { paste, tab, calls, delays, failures, setSession: value => { session = value; } };
}
test('paste waits for each write ACK before pacing or enqueuing more data', async () => {
  let release;
  const f = fixture({ send: () => new Promise(resolve => { release = resolve; }) });
  const task = f.paste.paste('first\nsecond');
  for (let i=0; i<10; i++) await Promise.resolve();
  assert.equal(f.paste.busy,true); assert.equal(f.delays.length,0);
  f.paste.send=async (...args)=>f.calls.push(args); release();
  assert.equal((await task).status,'sent'); assert.equal(f.delays.length,1); assert.equal(f.calls[0][1],'second');
});
test('both paste entry points share one lock, including async clipboard read', async () => {
  let read;
  const f=fixture();const first=f.paste.paste(()=>new Promise(resolve=>{read=resolve;}));
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal((await f.paste.paste('different native paste')).status,'busy');
  read('first');assert.equal((await first).status,'sent');assert.deepEqual(f.calls.map(c=>c[1]),['first']);
});
test('single-line text is bounded and UTF-16 pairs stay intact', async () => {
  const f=fixture();const text='😀'.repeat(499)+'X';assert.equal((await f.paste.paste(text)).status,'sent');
  assert.equal(f.calls.map(c=>c[1]).join(''),text);assert.ok(f.calls.every(c=>c[1].length<=256));
  for(const [,chunk] of f.calls)assert.ok(!/[\uD800-\uDBFF]$/.test(chunk));
});
test('CRLF and consecutive empty lines preserve exact server line endings', async () => {
  const f=fixture();await f.paste.paste('a\r\n\nlast\n');assert.equal(f.calls.map(c=>c[1]).join(''),'a\r\rlast\r');
});
test('write failure stops all remaining writes and retains uncertain chunk for manual recovery', async () => {
  let count=0;const f=fixture({send:async()=>{if(++count===2)throw new Error('write failed');}});
  const result=await f.paste.paste('first\nsecond\nthird');
  assert.equal(result.status,'failed');assert.equal(count,2);assert.equal(result.remaining,'second\rthird');assert.equal(result.uncertain,true);assert.equal(f.paste.busy,false);
});
test('session replacement while confirmation is open never sends to the new connection', async () => {
  const f=fixture();f.paste.confirm=async()=>{f.setSession('2');return true;};
  assert.equal((await f.paste.paste('x'.repeat(501))).status,'failed');assert.equal(f.calls.length,0);assert.equal(f.paste.failedDraft.uncertain,false);
});
test('disconnect, tab replacement and cancellation stop producer before the next write', async () => {
  for(const change of ['disconnect','replace','cancel']){
    const f=fixture();f.paste.sleep=async()=>{if(change==='disconnect')f.tab.isConnected=false;else if(change==='replace')f.paste.getTabById=()=>({...f.tab});else f.paste.cancel();};
    const result=await f.paste.paste('first\nsecond');assert.equal(result.status,'failed');assert.equal(f.calls.length,1);assert.equal(result.remaining,'second');assert.equal(result.uncertain,false);
  }
});
test('cancelled/oversized paste sends nothing and does not poison later operations',async()=>{
  const f=fixture({confirm:async()=>false});assert.equal((await f.paste.paste('x'.repeat(501))).status,'cancelled');
  assert.equal((await f.paste.paste('x'.repeat(30001))).status,'failed');assert.equal(f.calls.length,0);
  assert.equal((await f.paste.paste('okay')).status,'sent');
});

test('cancellation during asynchronous session check prevents the next send',async()=>{
  let release;let lookups=0;const f=fixture({getSession:async()=>{if(++lookups===2)return new Promise(resolve=>{release=resolve;});return 'one';}});
  const task=f.paste.paste('hello');for(let i=0;i<10;i++)await Promise.resolve();f.paste.cancel();release('one');
  assert.equal((await task).status,'failed');assert.equal(f.calls.length,0);
});

test('paste acquires input lease before reading and releases it on every exit', async () => {
  for (const outcome of ['sent', 'empty', 'error', 'cancel']) {
    const token = Symbol('paste'); let owner = null, read = false, released = 0;
    const f = fixture({ acquireInput() { assert.equal(owner, null); return owner = token; },
      releaseInput(id, lease) { assert.equal(lease, token); owner = null; released++; },
      send: async (id, text, session, lease, signal) => { assert.equal(lease, token); assert.equal(signal.aborted, false); },
    });
    const result = await f.paste.paste(({ signal }) => {
      read = true; assert.equal(owner, token);
      if (outcome === 'error') throw new Error('read failed');
      if (outcome === 'cancel') { f.paste.cancel(); assert.equal(signal.aborted, true); }
      return outcome === 'empty' ? '' : 'image URL';
    });
    assert.equal(read, true); assert.equal(released, 1); assert.equal(owner, null); assert.equal(f.paste.busy, false);
    assert.equal(result.status, outcome === 'sent' ? 'sent' : outcome === 'empty' ? 'empty' : 'failed');
  }
});

test('paste refuses a busy input lease before touching the clipboard or network', async () => {
  let reads = 0;
  const f = fixture({ acquireInput: () => null });
  assert.equal((await f.paste.paste(() => { reads++; return 'url'; })).status, 'busy');
  assert.equal(reads, 0); assert.equal(f.paste.busy, false);
});
