# Smart File Scan — Product Requirements

## Vision
A mobile-first cross-device file scanner that uses AI to dedupe and rename files across Internal storage, Google Drive (multiple accounts), and Dropbox.

## Core Features (v1)
1. **Auth** — JWT-based email/password (signup, login, /me).
2. **Storage sources** — Connect Google Drive & Dropbox via access tokens; manage multiple accounts; disconnect.
3. **Internal scan** — Pick device files via `expo-document-picker`; upload to backend; SHA256 hash + text extract.
4. **Cloud scan** — List files via Drive/Dropbox APIs; sample-download text files for content hashing.
5. **AI dedup** — Group by hash; for textual groups, ask Claude Sonnet 4.5 which file is most comprehensive.
6. **AI rename** — Detect generic names (IMG_*, DSC_*, Untitled, etc.); Claude suggests context-aware names.
7. **Delete & rename** — Remove/rename across all sources (local + remote API).
8. **Dashboard** — Stats: total files, sources, duplicates, generic names, recoverable space.

## Tech Stack
- Backend: FastAPI + Motor (MongoDB) + `emergentintegrations` (Claude Sonnet 4.5)
- Frontend: Expo SDK 54 + expo-router + react-native-keyboard-controller
- Auth: PyJWT + bcrypt

## Key Endpoints
- `POST /api/auth/signup|login` · `GET /api/auth/me`
- `GET /api/sources` · `POST /api/sources/gdrive` · `POST /api/sources/dropbox` · `DELETE /api/sources/{id}`
- `POST /api/files/upload` · `GET /api/files` · `DELETE /api/files/{id}` · `POST /api/files/{id}/rename`
- `POST /api/scan/gdrive/{source_id}` · `POST /api/scan/dropbox/{source_id}`
- `POST /api/scan/analyze` · `GET /api/scan/rename-candidates`
- `GET /api/dashboard/stats`

## Status
- v1.0 MVP shipped: auth, sources, scan (internal+cloud), AI dedup, AI rename.
