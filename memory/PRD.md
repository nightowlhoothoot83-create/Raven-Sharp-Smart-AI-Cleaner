# RavenSharp — by Ascension Digital Group

## Vision
**Cyber Intelligence. Digital Protection.**
A mobile-first cross-device file scanner that uses AI to dedupe and rename files across Internal storage, Google Drive (multiple accounts), and Dropbox. Part of the Ascension Digital Group portfolio.

## Brand
- **Product**: RavenSharp
- **Parent**: Ascension Digital Group (ascensiondigitalgroup.com)
- **Tagline**: Cyber Intelligence. Digital Protection.
- **Group tagline**: One Vision. Endless Possibilities.
- **Palette**: Deep black (#05050D) + electric blue (#2F7FFF) + violet (#7B3FF2) + gold accent (#FFC857) + cyan (#00D9FF)

## Brand Family (advertised in-app on dashboard)
1. **Ascension Digital Group** — Parent umbrella — Live — ascensiondigitalgroup.com
2. **MyCalcTools** — 38 calculators, 7 categories — Live — mycalctools.net
3. **MyCalendarTools** — Date/countdown/holiday tools — Live — mycalendartools.net
4. **WheelNamePicker** — Spinning decision wheel — Live — wheelnamepicker.com.au
5. **RavenSharp Image Optimiser** — AI image upscaling SaaS — Coming Soon — ravensharp.com.au
6. **RavenSharp POD Suite** — POD pipeline across 9 platforms — Coming Soon — ravensharp.com.au
7. **Mystical Moments** — Nature & owl photography — Live — mysticalmoments.pages.dev
8. **Zyia Creations** — Cosmic art / sacred geometry — Live — zyiacreations.etsy.com
9. **Spew Crew Kids** — Kids emotional-regulation content — Live — youtube.com/@spewcrewkids
10. **Feed the Feed** — Dystopian social commentary — Coming Soon

## Core Features (v1.1 — rebrand release)
1. **Auth** — JWT email/password (signup, login, /me).
2. **Storage sources** — Internal media library, SAF folders (Android), Google Drive, Dropbox.
3. **Internal scan** — `expo-media-library` auto-scans all photos & videos; `expo-document-picker` for documents; SAF folder picker on Android.
4. **Cloud scan** — Drive & Dropbox APIs with sample-download + content hashing.
5. **AI dedup** — Claude Sonnet 4.5 picks most-comprehensive file in each duplicate group.
6. **AI rename** — Detects generic names; Claude suggests context-aware names; user approves/edits/rejects.
7. **Cross-source delete & rename** — Removes from local + remote APIs.
8. **Dashboard** — Branded header (RavenSharp + Ascension), hero stats, sources, quick actions, **"More from Ascension Digital" carousel** with all 10 brands.
9. **Ascension footer** — Logo + link to parent group site.

## Tech Stack
- Backend: FastAPI + Motor (MongoDB) + `emergentintegrations` (Claude Sonnet 4.5)
- Frontend: Expo SDK 54 + expo-router + react-native-keyboard-controller + expo-media-library + expo-file-system (SAF)
- Auth: PyJWT + bcrypt

## Key Endpoints (unchanged from v1)
- `POST /api/auth/signup|login` · `GET /api/auth/me`
- `GET /api/sources` · `POST /api/sources/{gdrive|dropbox}` · `DELETE /api/sources/{id}`
- `POST /api/files/upload` · `POST /api/files/register` · `GET /api/files` · `DELETE /api/files/{id}` · `POST /api/files/{id}/rename`
- `POST /api/scan/{gdrive|dropbox}/{source_id}`
- `POST /api/scan/analyze` · `GET /api/scan/rename-candidates`
- `GET /api/dashboard/stats`

## Status
v1.1 RavenSharp rebrand shipped: full dark cosmic theme, brand assets, brand-family advertising carousel, app renamed to "RavenSharp".
