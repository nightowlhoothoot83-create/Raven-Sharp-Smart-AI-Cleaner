/* Read-only readiness check. Never sends account credentials or modifies files. */
(() => {
  const button = document.getElementById('check-connections');
  const result = document.getElementById('connection-check-result');
  async function read(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(API_BASE + path, { signal: controller.signal, cache: 'no-store' });
      return { ok: response.ok, data: await response.json().catch(() => ({})) };
    } finally { clearTimeout(timeout); }
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    result.textContent = 'Checking connections…';
    try {
      const [health, capabilities] = await Promise.allSettled([read('/health'), read('/capabilities')]);
      const live = health.status === 'fulfilled' && health.value.ok && health.value.data.ok === true;
      const ready = capabilities.status === 'fulfilled' && capabilities.value.ok && capabilities.value.data.content_review_version === 'v1';
      const ai = ready && capabilities.value.data.content_review_ready === true;
      const google = Boolean(window.SMART_CLEANER_GOOGLE_CLIENT_ID && !window.SMART_CLEANER_GOOGLE_CLIENT_ID.startsWith('YOUR_'));
      const dropbox = Boolean(window.SMART_CLEANER_DROPBOX_APP_KEY && !window.SMART_CLEANER_DROPBOX_APP_KEY.startsWith('YOUR_'));
      result.textContent = [
        live ? 'File service: connected.' : 'File service: unavailable or timed out. Try again shortly.',
        ready ? (ai ? 'AI content review: configured; review a small selection to test it.' : 'AI content review: API key setup needed.') : 'Scanning and source connections: waiting for the updated file service deployment. Login and viewing can be tested now.',
        'Google Drive sign-in: ' + (google ? 'configured.' : 'OAuth setup needed; advanced token connection is available.'),
        'Dropbox sign-in: ' + (dropbox ? 'configured.' : 'OAuth setup needed; advanced token connection is available.')
      ].join(' ');
    } finally { button.disabled = false; }
  });
})();
