# Raven Sharp AI File Manager — Shared API

The active product is the **Web app**, usable in a browser on phones and PCs. Finish, deploy and test that version first.

## Active backend

`backend/` contains the Shared API deployed on Railway. Both the current web interface and any future phone app can use it. Railway should deploy this repository's `main` branch.

The web interface lives in [Raven-Sharp-Smart-Cleaner-Web](https://github.com/nightowlhoothoot83-create/Raven-Sharp-Smart-Cleaner-Web) and uses `https://raven-sharp-smart-ai-cleaner-production.up.railway.app/api`.

## Paused Android prototype

`frontend/` contains an earlier Expo mobile prototype. Android work is paused. This folder is retained for reference and is not the active interface or part of the web release. Revisit a native phone app after the web product is finished and tested.

Repository URLs remain stable so the existing Railway backend connection is preserved.
