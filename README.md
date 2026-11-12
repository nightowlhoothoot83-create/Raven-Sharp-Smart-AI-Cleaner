# Raven Sharp Smart Cleaner — web and shared API

The canonical product source is this repository. `web/` is the active phone/PC browser interface; `backend/` is the existing Railway API. `frontend/` is a paused Expo prototype and is retained.

Cloudflare Pages must use `web/` as its output directory when the approved consolidation is released. Railway continues to build the root Dockerfile and deploy the existing backend; do not create another service. The separate Raven-Sharp-Smart-Cleaner-Web repository and its current deployment remain intact until the consolidated preview and production cutover are verified.

The web API proxy forwards only to the existing Railway backend. The account has cleaner.raven-sharp.com attached in Railway as well; check Cloudflare DNS/Pages routing before changing domains.

Run `node --test web/tests/*.test.cjs` for the offline browser/proxy suite (26 tests passed 13 November 2026 Brisbane). No content processing, external OAuth, deletion or generation is invoked by these tests.

See web/README.md and docs/consolidation-2026-11-13.md for the release checklist.
