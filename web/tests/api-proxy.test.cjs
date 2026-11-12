const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../_worker.js'), 'utf8');
const workerPromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('API proxy streams uploads and forwards auth only to the fixed backend', async () => {
  const worker = (await workerPromise).default;
  const original = global.fetch;
  try {
    global.fetch = async request => {
      if (typeof request === 'string') return Response.json({ ok: true, content_review_version: 'v1' });
      assert.equal(request.url, 'https://raven-sharp-smart-ai-cleaner-production.up.railway.app/api/files?limit=2');
      assert.equal(request.headers.get('authorization'), 'Bearer test');
      assert.equal(request.headers.get('cookie'), null);
      assert.equal(request.redirect, 'manual');
      assert.equal(await request.text(), 'upload');
      return Response.json({ ok: true });
    };
    const response = await worker.fetch(new Request('https://example.com/api/files?limit=2', { method: 'POST', body: 'upload', headers: { authorization: 'Bearer test', cookie: 'private=1' } }), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { global.fetch = original; }
});
test('an old backend cannot perform scans or mutations under the new dashboard', async () => {
  const worker = (await workerPromise).default;
  const original = global.fetch;
  let count = 0;
  try {
    global.fetch = async () => { count++; return Response.json({ ok: true }); };
    const response = await worker.fetch(new Request('https://example.com/api/scan/analyze?basic_only=true', { method: 'POST' }), {});
    assert.equal(response.status, 503);
    assert.equal(count, 1);
  } finally { global.fetch = original; }
});
test('API health uses real backend health and redirects never leak credentials', async () => {
  const worker = (await workerPromise).default;
  const original = global.fetch;
  try {
    global.fetch = async request => {
      assert.equal(new URL(request.url).pathname, '/health');
      return new Response(null, { status: 302, headers: { location: 'https://other.example/' } });
    };
    assert.equal((await worker.fetch(new Request('https://example.com/api/health'), {})).status, 502);
    global.fetch = async () => { throw Error('offline'); };
    assert.equal((await worker.fetch(new Request('https://example.com/api/health'), {})).status, 502);
  } finally { global.fetch = original; }
});
