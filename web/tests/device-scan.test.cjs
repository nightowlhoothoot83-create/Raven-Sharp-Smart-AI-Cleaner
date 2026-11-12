const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto, createHash } = require('node:crypto');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.textContent = ''; this.handlers = {}; this.disabled = false; this.checked = false; this.value = ''; this.classList = { toggle(){}, add(){}, remove(){} }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, fn) { this.handlers[event] = fn; }
  click() { return this.handlers.click?.(); }
  remove() {}
  setAttribute(name, value) { this[name] = value; }
}
function harness(apiImpl = async () => ({}), picker) {
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement(tag) { return new Element(tag); }, body: new Element() };
  document.getElementById('device-folder').webkitdirectory = true;
  const calls = [];
  const storage = new Map();
  const context = vm.createContext({ document, URLSearchParams, sessionStorage: {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}, history:{replaceState(){}}, location:{origin:'https://cleaner.raven-sharp.com',pathname:'/app.html',hash:'',search:''}, crypto: webcrypto, Uint8Array, Map, Blob, FormData, AbortController, DOMException, Date, JSON, console, token: 'session', confirm: () => true, URL, setTimeout: () => {}, fmtBytes: n => String(n), toast: () => {}, loadStats: async () => {}, api: async (path, options = {}) => { calls.push({ path, options }); return apiImpl(path, options); } });
  context.window = context;
  if (picker) context.showDirectoryPicker = picker;
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '..', 'device-scan.js'), 'utf8'), context);
  return { context, cleaner: context.Cleaner, calls, el: id => document.getElementById(id) };
}
function file(name, content, path) {
  const f = new File([content], name, { type: 'text/plain', lastModified: 100 });
  if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}
test('fingerprints cover the entire file, including bytes after 64KB', async () => {
  const { cleaner } = harness(); const a = 'x'.repeat(65536);
  assert.notEqual(await cleaner.hashFile(file('a', a + '1')), await cleaner.hashFile(file('b', a + '2')));
  assert.equal(await cleaner.hashFile(file('empty', '')), createHash('sha256').update('').digest('hex'));
});
test('folder fallback accepts nested files but rejects a picker returning individual files', () => {
  const h = harness();
  h.cleaner.selectFolderFiles([file('one.txt', '1', 'Docs/nested/one.txt'), file('two.txt', '2', 'Docs/two.txt')]);
  assert.match(h.el('selection-summary').textContent, /^2 files/);
  h.cleaner.selectFolderFiles([file('unexpected.txt', '3')]);
  assert.match(h.el('selection-summary').textContent, /^2 files/);
  assert.match(h.el('device-status').textContent, /instead of a folder picker/);
});
test('photo folder adds media from subfolders and excludes documents', () => {
  const h = harness();
  h.cleaner.selectFolderFiles([file('a.jpg', '1', 'DCIM/Camera/a.jpg'), file('clip.mp4', '2', 'DCIM/clip.mp4'), file('notes.txt', '3', 'DCIM/notes.txt')], true);
  assert.match(h.el('selection-summary').textContent, /^2 files/);
});
function directory(name, entries) {
  return { name, kind: 'directory', async *values() { yield* entries; } };
}
function entry(name, content) {
  return { name, kind: 'file', getFile: async () => file(name, content) };
}
test('native folder picker recursively scans files with distinct relative paths in read mode', async () => {
  const h = harness(async () => ({duplicate_groups:[]}), async options => {
    assert.equal(options.mode, 'read');
    return directory('Docs', [entry('same.txt', 'a'), directory('nested', [entry('same.txt', 'a')])]);
  });
  await h.cleaner.chooseFolder();
  assert.match(h.el('selection-summary').textContent, /^2 files/);
  await h.cleaner.scanSelected();
  const names = h.calls.filter(c => c.path === '/files/register').map(c => JSON.parse(c.options.body).items[0].name);
  assert.deepEqual(names, ['Docs/same.txt', 'Docs/nested/same.txt']);
});
test('cancelled folder selection preserves previous selection and does not open a file fallback', async () => {
  const h = harness(undefined, async () => { throw new DOMException('Cancelled', 'AbortError'); });
  h.cleaner.selectFiles([file('existing.txt', 'a')]);
  await h.cleaner.chooseFolder();
  assert.match(h.el('selection-summary').textContent, /^1 files/);
  assert.equal(h.cleaner.isBusy(), false);
});
test('logout during recursive folder reading discards late file results', async () => {
  let finish; const pending = new Promise(resolve => finish = resolve);
  const h = harness(undefined, async () => directory('Docs', [{name:'a.txt',kind:'file',getFile:()=>pending}]));
  const task = h.cleaner.chooseFolder();
  await new Promise(resolve => setImmediate(resolve));
  h.cleaner.reset(); finish(file('a.txt', 'a')); await task;
  assert.equal(h.el('selection-summary').textContent, 'No files selected.');
});
test('selection retains separate folder paths and avoids picking the same file twice', () => {
  const h = harness(); const a = file('a.txt', 'abc', 'one/a.txt'), b = file('a.txt', 'abc', 'two/a.txt');
  h.cleaner.selectFiles([a, a, b]); assert.match(h.el('selection-summary').textContent, /^2 files/);
});
test('default scan registers full hashes without uploading content, then compares', async () => {
  const h = harness(async path => path === '/scan/analyze?basic_only=true' ? { duplicate_groups: [] } : { candidates: [] });
  h.cleaner.selectFiles([file('a.txt', 'hello')]); await h.cleaner.scanSelected();
  assert.deepEqual(h.calls.map(c => c.path), ['/files', '/files/register', '/scan/analyze?basic_only=true']);
  const item = JSON.parse(h.calls[1].options.body).items[0];
  assert.equal(item.sha256, createHash('sha256').update('hello').digest('hex')); assert.match(item.external_id, /^web:/);
  assert.equal(h.el('device-scan-btn').disabled, false);
});
test('opt-in content upload uses multipart; a repeated existing file is reused', async () => {
  let existing = []; const h = harness(async path => {
    if (path === '/files') return { files: existing };
    if (path === '/files/upload') return { id: 'uploaded' };
    if (path === '/scan/analyze?basic_only=true') return { duplicate_groups: [] };
    return { candidates: [] };
  });
  h.el('content-analysis').checked = true; h.cleaner.selectFiles([file('a.txt', 'hello')]); await h.cleaner.scanSelected();
  const upload = h.calls.find(c => c.path === '/files/upload'); assert.ok(upload.options.body instanceof FormData);
  assert.equal(upload.options.body.get('file').name, 'a.txt');
  existing = [{ id: 'uploaded', source: 'internal', name: 'a.txt', size: 5, sha256: createHash('sha256').update('hello').digest('hex') }];
  await h.cleaner.scanSelected(); assert.equal(h.calls.filter(c => c.path === '/files/upload').length, 1);
});
test('file failures are visible and do not prevent remaining files from scanning', async () => {
  let registered = 0; const h = harness(async path => {
    if (path === '/files/register' && registered++ === 0) throw new Error('Network unavailable');
    return { duplicate_groups: [], candidates: [] };
  });
  h.cleaner.selectFiles([file('bad.txt', 'bad'), file('good.txt', 'good')]); await h.cleaner.scanSelected();
  assert.equal(h.el('scan-errors').children.length, 1); assert.match(h.el('device-status').textContent, /1 files scanned; 1 skipped/);
});
test('stopping a scan prevents analysis and logout clears file references', async () => {
  let resolve; const pending = new Promise(r => resolve = r); const h = harness(async path => { if (path === '/files/register') await pending; return {}; });
  h.cleaner.selectFiles([file('a.txt', 'abc')]); const task = h.cleaner.scanSelected();
  while (!h.calls.some(c => c.path === '/files/register')) await new Promise(r => setImmediate(r));
  h.el('cancel-scan').click(); resolve(); await task;
  assert.ok(!h.calls.some(c => c.path === '/scan/analyze?basic_only=true')); assert.match(h.el('device-status').textContent, /Scan stopped/);
  h.cleaner.reset(); assert.equal(h.el('selection-summary').textContent, 'No files selected.');
});
test('untrusted filenames render as text and cloud records have no delete action', () => {
  const h = harness(); const malicious = '<img src=x onerror=alert(1)>';
  h.cleaner.renderGroups([{kind:'exact_duplicate',keep_id:'keep',reason:malicious,files:[{id:'other',name:malicious,source:'gdrive',size:2}]}]);
  const card = h.el('groups-list').children[0]; assert.equal(card.children[1].textContent, malicious);
  const row = card.children[3]; assert.ok(row.children.some(c => c.textContent.includes(malicious))); assert.ok(!row.children.some(c => c.tagName === 'button'));
});
test('cloud scan invokes source scanning before analysis', async () => {
  const h = harness(async path => path === '/sources' ? {sources:[{type:'gdrive',id:'drive',label:'Drive'}]} : {duplicate_groups:[],candidates:[]});
  await h.cleaner.scanCloud(); assert.deepEqual(h.calls.map(c=>c.path), ['/sources','/scan/gdrive/drive','/scan/analyze?basic_only=true']);
});
test('metadata scans reuse earlier content uploads instead of introducing false duplicates', async () => {
  const h = harness(async path => path === '/files' ? {files:[{id:'old',source:'internal',name:'a.txt',size:5,sha256:createHash('sha256').update('hello').digest('hex')}]} : {duplicate_groups:[],candidates:[]});
  h.cleaner.selectFiles([file('a.txt','hello')]); await h.cleaner.scanSelected();
  assert.ok(!h.calls.some(c=>c.path === '/files/register' || c.path === '/files/upload'));
});
test('oversized files are skipped before attempting to read or upload', async () => {
  const h = harness(); let read = false;
  h.cleaner.selectFiles([{name:'large.mp4',size:129*1024*1024,lastModified:100,arrayBuffer:async()=>{read=true;}}]);
  await h.cleaner.scanSelected(); assert.equal(read,false); assert.equal(h.el('scan-errors').children.length,1);
  assert.ok(!h.calls.some(c=>c.path === '/files/register' || c.path === '/files/upload'));
});
test('removing an internal scan record requires confirmation and calls only its account record route', async () => {
  const h = harness(async()=>({duplicate_groups:[]}));
  h.cleaner.renderGroups([{kind:'exact_duplicate',keep_id:'keep',files:[{id:'local',source:'internal',name:'a.txt',size:1}]}]);
  const button = h.el('groups-list').children[0].children[3].children.find(c=>c.tagName==='button');
  h.context.confirm = () => false; await button.click(); assert.equal(h.calls.length,0);
  h.context.confirm = message => {assert.match(message,/NOT be deleted/);return true;}; await button.click();
  assert.equal(h.calls[0].path,'/files/local'); assert.equal(h.calls[0].options.method,'DELETE');
});

function sourcesHarness(apiImpl) {
 const h = harness(apiImpl);
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '..', 'source-dashboard.js'), 'utf8'), h.context);
 return h;
}
test('dashboard displays backend source envelopes and retains deselection on refresh', async () => {
 const h = sourcesHarness(async()=>({sources:[{id:'drive',type:'gdrive',label:'Work drive'},{id:'one',type:'onedrive',label:'OneDrive'}]}));
 await h.context.SourceDashboard.load();
 const list=h.el('sources-list');assert.equal(list.children.length,2);
 const input=list.children[0].children[0].children[0];assert.equal(input.checked,true);
 assert.equal(list.children[1].children[0].children[0].disabled,true);
 input.checked=false;input.handlers.change();await h.context.SourceDashboard.load();
 assert.equal(h.context.SourceDashboard.selectedSources({sources:[{id:'drive',type:'gdrive'}]}).length,0);
});
test('cloud scanning honors dashboard selection and displays partial failures', async()=>{
 const h=sourcesHarness(async path=>{
  if(path==='/sources')return {sources:[{id:'a',type:'gdrive',label:'A'},{id:'b',type:'dropbox',label:'B'}]};
  if(path==='/scan/gdrive/a')throw new Error('Expired token');
  return {duplicate_groups:[],candidates:[]};
 });
 await h.context.SourceDashboard.load();await h.cleaner.scanCloud();
 assert.ok(h.calls.some(c=>c.path==='/scan/dropbox/b'));assert.match(h.el('scan-status').textContent,/1 accounts failed/);
 const checkbox=h.el('sources-list').children[0].children[0].children[0];checkbox.checked=false;checkbox.handlers.change();
 h.calls.length=0;await h.cleaner.scanCloud();assert.ok(!h.calls.some(c=>c.path==='/scan/gdrive/a'));
});
test('provider sign-in uses nonce state and rejects unmatched callbacks',async()=>{
 const h=sourcesHarness(async()=>({sources:[]}));h.context.SMART_CLEANER_GOOGLE_CLIENT_ID='configured.apps.googleusercontent.com';
 h.context.SourceDashboard.connect('gdrive');
 const query=new URL(h.context.location.href).searchParams;
 assert.notEqual(query.get('state'),'gdrive');assert.equal(query.get('scope'),'https://www.googleapis.com/auth/drive');
 h.context.location.hash='#access_token=private-token&state=wrong';await h.context.SourceDashboard.callback();
 assert.equal(h.calls.length,0);assert.match(h.el('connection-status').textContent,/could not be verified/);
});
test('manual connections validate through API and clear entered credentials',async()=>{
 const h=sourcesHarness(async()=>({sources:[]}));h.el('connect-token').value='secret';
 await h.context.SourceDashboard.save('dropbox','secret','Work');
 const call=h.calls.find(c=>c.path==='/sources/dropbox');assert.equal(JSON.parse(call.options.body).access_token,'secret');
 assert.equal(h.el('connect-token').value,'');
});
function cleanupHarness(apiImpl) {
 const h=sourcesHarness(apiImpl);
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..','content-cleanup.js'),'utf8'),h.context);
 return h;
}
test('content cleanup requires consent and reports content coverage without mutating files',async()=>{
 const h=cleanupHarness(async path=> path==='/scan/content-review'?{recommendations:[{file:{id:'f',name:'IMG_1.png',source:'internal'},action:'review',flags:['blurry'],reason:'May be unique',evidence:'unavailable',suggested_name:null}]}:{});
 h.context.ContentCleanup.setFiles([{id:'f',name:'IMG_1.png',source:'internal'}],[]);
 await h.context.ContentCleanup.run();assert.equal(h.calls.length,0);
 h.el('review-consent').checked=true;await h.context.ContentCleanup.run();
 assert.equal(h.calls[0].path,'/scan/content-review');assert.equal(JSON.parse(h.calls[0].options.body).approved_content_processing,true);
 assert.ok(!h.calls.some(c=>c.options.method==='DELETE'||c.path.includes('/rename')));
});
test('manual filename edits require confirmation and the approved name is sent exactly',async()=>{
 const h=cleanupHarness(async()=>({renamed:true}));
 const editor=h.context.ContentCleanup.editableRename({id:'cloud',name:'IMG_1.png',source:'gdrive'},'suggested.png',null);
 const input=editor.children.find(c=>c.tagName==='input');input.value='my-manual-name.png';
 const button=editor.children.find(c=>c.tagName==='button');h.context.confirm=()=>false;await button.click();assert.equal(h.calls.length,0);
 h.context.confirm=()=>true;await button.click();assert.equal(JSON.parse(h.calls[0].options.body).new_name,'my-manual-name.png');
});
test('basic duplicates exclude extra exact copies while keeping one for content version comparison',()=>{
 const h=cleanupHarness(async()=>({}));const files=[{id:'a',name:'old.txt'},{id:'b',name:'old-copy.txt'},{id:'c',name:'final.txt'}];
 h.context.ContentCleanup.setFiles(files,[{kind:'exact_duplicate',keep_id:'a',files:files.slice(0,2)}]);
 assert.equal(h.el('content-candidates').children.length,2);
});

