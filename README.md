# Raven Sharp AI File Manager — Android and Shared API

This repository contains two components:

| Component | Folder | Role |
|---|---|---|
| Raven Sharp AI File Manager — Android | `frontend/` | Expo mobile app |
| Raven Sharp AI File Manager — Shared API | `backend/` | Python API deployed on Railway, used by both Android and the web app |

The web interface is maintained separately in [Raven-Sharp-Smart-Cleaner-Web](https://github.com/nightowlhoothoot83-create/Raven-Sharp-Smart-Cleaner-Web). It runs in a browser on phones and PCs and is hosted on Cloudflare Pages.

Railway must deploy this repository's `main` branch for the Shared API. The web interface connects to `https://raven-sharp-smart-ai-cleaner-production.up.railway.app/api`.

Display labels distinguish the components; repository paths and deployment URLs remain stable. A future repository separation must migrate the backend source, CI, deployment settings and both client API connections together.
