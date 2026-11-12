async function withSharedFooter(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  if (!html.includes('/adg-footer.js')) {
    html = html.includes('</body>')
      ? html.replace('</body>', '<script src="/adg-footer.js" defer></script></body>')
      : html + '<script src="/adg-footer.js" defer></script>';
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const upstream = new URL('https://raven-sharp-smart-ai-cleaner-production.up.railway.app');
      upstream.pathname = url.pathname === '/api/health' ? '/health' : url.pathname;
      upstream.search = url.search;
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('cookie');
      headers.delete('origin');
      try {
        const needsCurrentBackend = url.pathname.startsWith('/api/scan/') ||
          (url.pathname.startsWith('/api/files') && !['GET', 'HEAD'].includes(request.method)) ||
          (url.pathname.startsWith('/api/sources') && request.method === 'POST');
        if (needsCurrentBackend) {
          const healthResponse = await fetch('https://raven-sharp-smart-ai-cleaner-production.up.railway.app/health', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
          const health = healthResponse.ok ? await healthResponse.json() : {};
          if (health.content_review_version !== 'v1') {
            return Response.json({ detail: 'The updated file service is not deployed yet. Login and viewing are available; connecting sources, scanning and file changes will unlock after the backend update.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
          }
        }
        const response = await fetch(new Request(upstream, {
          method: request.method, headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'manual', signal: AbortSignal.timeout(120000),
          duplex: 'half'
        }));
        if (response.status >= 300 && response.status < 400) {
          return Response.json({ detail: 'The file service returned an unexpected redirect. Please retry later.' }, { status: 502 });
        }
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.delete('set-cookie');
        return new Response(response.body, { status: response.status, headers: responseHeaders });
      } catch (error) {
        return Response.json({ detail: 'The file service could not be reached. Check connections and try again.' }, { status: error.name === 'TimeoutError' ? 504 : 502 });
      }
    }
    return withSharedFooter(await env.ASSETS.fetch(request));
  }
};

