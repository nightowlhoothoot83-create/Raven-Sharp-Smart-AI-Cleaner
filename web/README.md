# Smart Cleaner web interface

This folder is the canonical active browser UI within Raven-Sharp-Smart-AI-Cleaner. The old separate web repository remains preserved while the hosting cutover is pending. `frontend/` is a paused Expo prototype, not the web app.

Cloudflare Pages: output directory `web`, no build command. Keep the existing `_worker.js` proxy, `_headers`, `_redirects`, API health routes, legal pages and all seven `brands/` images.

Railway: retain the existing backend service, source repository and Dockerfile. API origin stays https://raven-sharp-smart-ai-cleaner-production.up.railway.app/api. Do not point Railway at web/ or add a second backend.

Before production switch: verify a preview, login, folder selection, basic-only scan, OAuth source selection, logout and no unexpected file mutation. Paid content review and renaming/deletion require separate approval. Run `node --test web/tests/*.test.cjs` (26 offline tests pass). Tests do not establish live OAuth or correct Cloudflare routing.
