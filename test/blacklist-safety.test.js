import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal UI/event doubles; HTML output assertions below are not a browser XSS exploit test.
class Element {
  constructor() { this.children = []; this.events = {}; this.style = {}; this.dataset = {}; this.value = ''; this._html = ''; this.scrollTop = 0; this.classes = new Set();
    this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c), contains: c => this.classes.has(c), toggle: c => { if (this.classes.has(c)) { this.classes.delete(c); return false; } this.classes.add(c); return true; } }; }
  set innerHTML(value) { this._html = value; this.children = []; this.selectors = new Map(); }
  get innerHTML() { return this._html; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._html = ''; this.children = children; }
  addEventListener(name, fn) { const previous = this.events[name]; this.events[name] = previous ? event => { previous(event); fn(event); } : fn; }
  querySelector(selector) { if (!this._html.includes(selector.slice(1))) return null; this.selectors ||= new Map(); if (!this.selectors.has(selector)) this.selectors.set(selector, new Element()); return this.selectors.get(selector); }
  querySelectorAll() { return []; }
}
const nodes = new Map();
globalThis.document = { body: new Element(), createElement: () => new Element(), getElementById: id => nodes.get(id), querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = { addEventListener() {}, devicePixelRatio: 1, __TAURI__: { core: { invoke: async () => {} }, event: { listen() {} } } };
const { BlacklistManager, blacklistManager, BLACKLIST_LIMITS } = await import('../src/blacklist.js');
const { TermView } = await import('../src/term_view.js');
const { TermBuf } = await import('../src/term_buf.js');
const { SettingsUI } = await import('../src/settings_ui.js');
const { ArticleReaderModal } = await import('../src/article_reader.js');
const { ConnectionController } = await import('../src/connection_controller.js');
const { NotificationManager } = await import('../src/notifications.js');
const { settingsManager } = await import('../src/settings.js');
beforeEach(() => {
  nodes.clear();
  blacklistManager.importFromJSON({ version: '2.0', blacklist: [], keywords: [], settings: { enabled: true, mode: 'dim', enableGreatTreasure: false, enableKeywords: true, blockWaterball: true, blockPushNotification: true } }, { replace: true });
  settingsManager.settings.notifyEnabled = true;
});
function storage() { const data = new Map(); return { writes: 0, getItem: key => data.get(key) ?? null, setItem(key, value) { this.writes++; data.set(key, value); } }; }
function viewWith(lines = {}) {
  const view = Object.create(TermView.prototype);
  view.buf = new TermBuf(80, 24);
  for (const [row, text] of Object.entries(lines)) [...text].slice(0, 80).forEach((ch, col) => { view.buf.lines[row][col].ch = ch; });
  view.rowMetadataCache = new Map(); view.rowUrlCache = new Map(); view.measureCache = new Map();
  return view;
}
test('invalid IDs, control characters, and oversized keywords are rejected', () => {
  const m = new BlacklistManager(null);
  for (const value of ['<b>proof</b>', 'a', '1234', 'abcdefghijklmn', {}, 'a-b']) assert.equal(m.add(value), false);
  for (const value of ['a\nb', '\x1b[31m', 'x'.repeat(257)]) assert.equal(m.addKeyword(value), false);
  assert.equal(m.addKeyword('"<b>#a,b;</b>'), true);
});
test('legacy preferences migrate, corrupt settings normalize, built-in defaults off', () => {
  const s = storage(); s.setItem('bbsterm_blacklist', JSON.stringify(['ValidID', '<b>bad</b>']));
  s.setItem('bbsterm_blacklist_settings', JSON.stringify({ mode: 'invalid', enabled: 'false', enableGreatTreasure: true }));
  const m = new BlacklistManager(s);
  assert.deepEqual(m.getCustomListArray(), ['validid']); assert.equal(m.getMode(), 'dim'); assert.equal(m.settings.enabled, true);
  assert.equal(m.settings.enableGreatTreasure, false);
  m.addKeyword('保留'); const reloaded = new BlacklistManager(s); assert.equal(reloaded.isBlacklisted('validid'), true); assert.equal(reloaded.isKeywordBlacklisted('保留'), '保留');
});
test('built-in exception survives reload and backup, toggle works while disabled', () => {
  const s = storage(), m = new BlacklistManager(s); m.saveSettings({ enableGreatTreasure: true });
  assert.equal(m.toggle('idcc'), false); assert.equal(m.isBlacklisted('idcc'), false);
  assert.equal(new BlacklistManager(s).isBlacklisted('idcc'), false);
  const restored = new BlacklistManager(null); assert.equal(restored.importFromJSON(m.exportAsJSON()).success, true); assert.equal(restored.isBlacklisted('idcc'), false);
  assert.equal(m.toggle('idcc'), true); assert.equal(m.isBlacklisted('idcc'), true);
  m.saveSettings({ enabled: false }); assert.equal(m.toggle('someone'), true); assert.equal(m.toggle('someone'), false); assert.equal(m.customList.has('someone'), false);
});
test('JSON import validates everything before mutation and emits one write/change', () => {
  const s = storage(), m = new BlacklistManager(s); let events = 0; m.onChange(() => events++);
  assert.equal(m.importFromJSON({ blacklist: Array.from({length:1000}, (_,i) => `user${i}`) }).success, true);
  assert.equal(s.writes, 1); assert.equal(events, 1);
  const before = m.exportAsJSON();
  for (const payload of [{blacklist:['valid', '<bad>']}, {blacklist:null}, {settings:{mode:'bogus'}}, {version:'9.0',keywords:['x']}, [], {}, {keywords:['x'.repeat(257)]}]) assert.equal(m.importFromJSON(payload).success, false);
  assert.equal(m.customList.size, 1000); assert.equal(s.writes, 1); assert.equal(events, 1);
  assert.deepEqual(JSON.parse(m.exportAsJSON()).blacklist, JSON.parse(before).blacklist);
  assert.equal(m.importFromJSON(' '.repeat(BLACKLIST_LIMITS.importLength + 1)).success, false);
});
test('failed persistence leaves previous in-memory state intact', () => {
  const m = new BlacklistManager({ getItem: () => null, setItem() { throw new Error('quota'); } });
  assert.equal(m.importFromJSON({blacklist:['validid']}).success, false); assert.equal(m.customList.size, 0);
});
test('literal keyword TXT round trip preserves punctuation and comment-looking text', () => {
  const m = new BlacklistManager(null); for (const kw of ['a,b', '#tag', '//path', 'a;b', 'x " y', '[公告]']) m.addKeyword(kw);
  const copy = new BlacklistManager(null); copy.importKeywordsFromText(m.exportKeywordsAsText()); assert.deepEqual(copy.getCustomKeywordsArray(), m.getCustomKeywordsArray());
});
test('keyword-only settings UI renders and delete keeps quoted keyword intact', () => {
  const ui = Object.create(SettingsUI.prototype); ui.blacklistManager = new BlacklistManager(null);
  const keyword = '" data-proof="<b>x</b>'; ui.blacklistManager.addKeyword(keyword);
  ui.elements = { blacklistTagsContainer: new Element(), blacklistKwTagsContainer: new Element(), blacklistKwCount: new Element() };
  ui.renderBlacklistUI(); assert.equal(ui.elements.blacklistKwCount.textContent, '1');
  const tag = ui.elements.blacklistKwTagsContainer.children[0]; assert.equal(tag.children[0].textContent, `🔤 ${keyword}`); assert.equal(tag.innerHTML, '');
  tag.children[1].events.click({stopPropagation(){}}); assert.equal(ui.blacklistManager.customKeywords.size, 0); assert.equal(ui.elements.blacklistKwCount.textContent, '0');
});
test('settings JSON upload restores users, keywords and settings, resets upload field', () => {
  class UI extends SettingsUI { loadSettingsToUI() { this.loaded = true; } renderBlacklistUI() {} }
  const input = new Element(); const ui = Object.create(UI.prototype);
  Object.assign(ui, { elements: { btnBlacklistImport: new Element(), fileBlacklistImport: input }, blacklistManager: new BlacklistManager(null), onShowToast() {} });
  globalThis.FileReader = class { readAsText(file) { this.onload({target:{result:file.content}}); } };
  ui.initEventListeners(); input.value = 'backup.JSON';
  input.events.change({target:{files:[{ name:'backup.JSON',size:100,content:JSON.stringify({version:'2.0',blacklist:['someuser'],keywords:['詞'],settings:{mode:'mask'}}) }]}});
  assert.equal(ui.loaded,true); assert.equal(ui.blacklistManager.getMode(),'mask'); assert.equal(ui.blacklistManager.isBlacklisted('someuser'),true); assert.equal(ui.blacklistManager.customKeywords.has('詞'),true); assert.equal(input.value,'');
});
test('selected and pinned article rows filter, but prompts/editor/unknown screens stay visible', () => {
  blacklistManager.add('blockeduser'); blacklistManager.addKeyword('密碼');
  const v = viewWith({0:'【看板】 test', 2:'>1234 + 9/02 blockeduser □ title',3:' 1235 + 9/02 someone □ title', 23:'文章列表'});
  assert.equal(v.getBbsState(),'article-list'); assert.equal(v.getRowMetadata(2).isBlacklisted,true);
  v.buf.lines[2][0].ch = '★'; assert.equal(v.getRowMetadata(2).isBlacklisted,true);
  const password = viewWith({23:'請輸入您的密碼：'}); assert.equal(password.getRowMetadata(23).isBlacklisted,false);
  const unknown = viewWith({2:'推 blockeduser: 密碼'}); assert.equal(unknown.getRowMetadata(2).isBlacklisted,false);
  const editor = viewWith({2:'推 blockeduser: 密碼',23:'[Ctrl-X] 儲存離開'}); assert.equal(editor.getBbsState(),'compose'); assert.equal(editor.getRowMetadata(2).isBlacklisted,false);
});
test('wrapped push inherits blocked author and content changes invalidate cached/revealed state', () => {
  blacklistManager.add('blockeduser'); blacklistManager.saveSettings({mode:'mask'});
  const v = viewWith({2:'推 blockeduser: '+ 'x'.repeat(80),3:'  wrapped content',23:'瀏覽 第 1 頁'});
  assert.equal(v.getRowMetadata(3).isBlacklisted,true);
  v.redraw = () => {}; v.revealBlacklistRow(3); assert.equal(v.isRowMasked(3),false);
  v.buf.lines[3][10].ch='y'; assert.equal(v.isRowMasked(3),true);
  v.selection={startX:0,startY:2,endX:79,endY:3}; assert.equal(v.getSelectionText(),''); assert.equal(v.getSelectionAnsi(),''); assert.equal(v.getWordAt(5,2),'');
});
test('canvas restores row alpha, clips fractional rows and keeps buffer/cursor intact', () => {
  blacklistManager.add('blockeduser');
  const v = viewWith({2:'推 blockeduser: blocked',3:'推 someone: NORMAL',23:'瀏覽 第 1 頁'});
  const texts=[], rects=[], stack=[];
  const base={globalAlpha:1, save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},fillText(text,x,y){texts.push({text,alpha:this.globalAlpha,y});},rect(...args){rects.push(args);},measureText(){return {width:8};}};
  v.ctx=new Proxy(base,{get(target,key){return key in target ? target[key] : ()=>{};}});
  Object.assign(v,{cellW:8,cellH:15.5,canvas:{width:640,height:372},cursorStyle:'none',getRenderFontFamilyString:()=> 'monospace',updateImePosition(){}});
  const original=v.buf.getText(0,0,79,23), cursor=[v.buf.cur_x,v.buf.cur_y];
  // Simulate malformed external mutation too: rendering must still recover safely.
  blacklistManager.settings.mode='invalid'; v.redraw();
  assert.equal(v.ctx.globalAlpha,1); assert.equal(stack.length,0); assert.ok(texts.some(t=>t.alpha===0.2)); assert.ok(texts.some(t=>t.text==='N'&&t.alpha===1));
  blacklistManager.saveSettings({mode:'mask'}); texts.length=0; v.redraw(); assert.ok(texts.some(t=>t.text.startsWith('[🛡️'))); assert.ok(!texts.some(t=>t.y===39&&t.text==='b'));
  assert.deepEqual(rects.slice(0,24).map(r=>r[3]),Array.from({length:24},(_,r)=>Math.round((r+1)*15.5)-Math.round(r*15.5)));
  assert.equal(v.buf.getText(0,0,79,23),original); assert.deepEqual([v.buf.cur_x,v.buf.cur_y],cursor);
});
test('Bell cannot sound before classification; blocked direct notification also stays silent', async () => {
  class Controller extends ConnectionController { initEventListeners() {} initTauriListeners() {} }
  let sounds=0,scrapes=0; const n=new NotificationManager(); n.playChime=()=>sounds++;
  const tabs={}; const c=new Controller({tabManager:tabs,notificationManager:n,elements:{}}); c.scheduleNotificationScrape=()=>scrapes++;
  tabs.onBell({id:'tab'}); assert.equal(sounds,0); assert.equal(scrapes,1);
  blacklistManager.add('blockeduser'); await n.triggerWaterballNotification('tab','blockeduser','hello','PTT'); assert.equal(sounds,0);
});
test('forged timestamps and mail-looking bodies cannot bypass keyword notification suspension', async () => {
  const n=new NotificationManager(), received=[];let sounds=0;
  n.triggerWaterballNotification=(...args)=>received.push(args);n.playChime=()=>sounds++;n.triggerMailNotification=()=>sounds++;
  blacklistManager.addKeyword('blockedword');
  for(const line of ['★normaluser: hello [12:34]','★normaluser: hello [12:34] blockedword [10/19 12:35]','★normaluser: 收到新信件 [12:34]']) n.feedScreenLines('tab',[line]);
  assert.equal(received.length,0);assert.equal(sounds,0);
  // Without content rules, ordinary punctuation is still accepted.
  blacklistManager.clearKeywords();n.feedScreenLines('tab',['★normaluser: [公告] hello! ★ [10/19 12:35]']);assert.equal(received.length,1);
});
test('reader escapes rule reasons/attributes and masks spoiler title until reveal', () => {
  const kw='"<b>proof</b>'; blacklistManager.addKeyword(kw); blacklistManager.saveSettings({mode:'mask'});
  for (const id of ['reader-title','reader-article-content','push-list']) nodes.set(id,new Element());
  const reader=Object.create(ArticleReaderModal.prototype); reader.fontSize=16; reader.currentFilter='all'; reader.pushSearchQuery=''; reader.renderBodyBlocks=()=>{};
  const article={title:`spoiler ${kw}`,author:'normaluser',board:'test',time:'',bodyBlocks:[],pushStats:{push:1,boo:0,arrow:0},pushList:[{user:'normaluser',tag:'推',content:`hello ${kw}`,floor:1,time:'',ip:''}]};
  reader.renderArticle(article);
  const title=nodes.get('reader-title'); assert.equal(title.innerHTML,''); assert.ok(!title.children[0].textContent.includes('spoiler'));
  title.children[0].events.click(); assert.equal(title.textContent,article.title);
  const body=nodes.get('reader-article-content'); assert.ok(!body.children[0].innerHTML.includes('<b>proof</b>')); assert.ok(body.children[0].innerHTML.includes('&lt;b&gt;proof'));
  const push=nodes.get('push-list').children[0]; assert.ok(!push.innerHTML.includes('<b>proof</b>')); assert.ok(push.innerHTML.includes('&lt;b&gt;proof'));
});

test('reading title headers without a colon filter; body prose and footers do not', () => {
  blacklistManager.addKeyword('spoiler');
  const view = viewWith({1:'標題 [新聞] spoiler',2:'ordinary body spoiler',23:'瀏覽 第 1 頁 spoiler'});
  assert.equal(view.getRowMetadata(1).isBlacklisted,true);
  assert.equal(view.getRowMetadata(2).isBlacklisted,false);
  assert.equal(view.getRowMetadata(23).isBlacklisted,false);
});

test('membership labels use exact rules even when filtering is disabled', () => {
  const m = new BlacklistManager(null); m.add('someuser'); m.addKeyword('buy'); m.saveSettings({ enabled: false });
  assert.equal(m.hasUserRule('someuser'), true); assert.equal(m.isBlacklisted('someuser'), false);
  assert.equal(m.hasKeywordRule('buy'), true); assert.equal(m.hasKeywordRule('buy now'), false);
});
test('settings storage failure reports error and preserves the typed ID', () => {
  const ui=Object.create(SettingsUI.prototype);const input=new Element();input.value='someuser';const button=new Element();let message='';
  Object.assign(ui,{elements:{btnBlacklistAdd:button,inputBlacklistAdd:input},blacklistManager:new BlacklistManager({getItem:()=>null,setItem(){throw new Error('quota');}}),onShowToast:text=>{message=text;}});
  ui.initEventListeners();button.events.click();assert.equal(input.value,'someuser');assert.equal(ui.blacklistManager.customList.size,0);assert.ok(message.includes('儲存失敗'));
});

test('oversized legacy ID/keyword lists stay effective across writes and reloads', () => {
  const s=storage(),ids=Array.from({length:6000},(_,i)=>`user${i}`),words=Array.from({length:1001},(_,i)=>`word${i}`);
  s.setItem('bbsterm_blacklist',JSON.stringify(ids));s.setItem('bbsterm_blacklist_keywords',JSON.stringify(words));
  const m=new BlacklistManager(s);assert.equal(m.customList.size,6000);assert.equal(m.isBlacklisted('user5999'),true);assert.equal(m.customKeywords.size,1001);
  assert.equal(m.getLimitWarnings().length,2);assert.equal(m.add('newuser'),false);m.remove('user0');
  const copy=new BlacklistManager(s);assert.equal(copy.customList.size,5999);assert.equal(copy.isBlacklisted('user5999'),true);
  assert.equal(copy.importFromJSON({blacklist:['newuser']}).success,false);assert.equal(copy.isBlacklisted('user5999'),true);
});
test('normal push image URL is scoped correctly and masked media stays deferred inside body', () => {
  const list=new Element();nodes.set('push-list',list);
  const reader=Object.create(ArticleReaderModal.prototype);reader.currentFilter='all';reader.pushSearchQuery='';reader.revealedPushes=new Set();
  reader.currentArticle={author:'someone',pushList:[{user:'someone',tag:'推',content:'hello',time:'',images:[{url:'https://example.invalid/a.jpg'}],youtubes:[{}]}]};
  reader.createYoutubeCard=()=>new Element();reader.renderPushList();
  assert.equal(list.children[0].children[0].src,'https://example.invalid/a.jpg');
  blacklistManager.add('someone');blacklistManager.saveSettings({mode:'mask'});reader.renderPushList();
  const row=list.children[0],body=row.querySelector('.push-masked-body');assert.equal(row.children.length,0);assert.equal(body.children.length,0);
  body.classList.add('hidden');row.querySelector('.push-mask-reveal-btn').events.click({stopPropagation(){},target:{}});
  assert.equal(body.children.length,2);assert.equal(row.children.length,0);
});

test('article paging uses the injected transport and stops on send failure', async () => {
  const reader = Object.create(ArticleReaderModal.prototype);
  const tab = { id: 'article-tab', buf: {} };
  const writes = [];
  reader.getConnectionSession = async id => { assert.equal(id, tab.id); return 'article-session'; };
  reader.waitForBufferUpdate = async () => {};
  reader.getScreenLines = () => Array.from({ length: 24 }, (_, row) => row === 23 ? (writes.length >= 2 ? '100%' : '瀏覽 第 1/2 頁') : 'article body');
  reader.sendToTab = async (...args) => writes.push(args);
  await reader.crawlFullArticle(tab);
  assert.deepEqual(writes, [[tab.id, '\x1b[1~', 'article-session'], [tab.id, ' ', 'article-session']]);
  writes.length = 0;
  reader.sendToTab = async (...args) => { writes.push(args); throw new Error('STALE_CONNECTION_SESSION'); };
  await assert.rejects(reader.crawlFullArticle(tab), /STALE_CONNECTION_SESSION/);
  assert.equal(writes.length, 1);
});
