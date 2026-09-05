# Smart Cleaner OAuth + Cleaning Gap Audit

Branch-only audit. No production changes, OAuth credential changes, file mutations, merge, or deploy are authorised by this document.

## What already exists

The current app already contains:

- SaaS authentication in the backend.
- A Google Drive OAuth hook in `frontend/src/google-drive.ts`.
- Google OAuth scopes including `openid`, `profile`, `email`, and full Drive scope.
- A frontend call that sends the returned Google access token to `/api/sources/gdrive`.
- A backend `/api/sources/gdrive` route that validates the token before storing/using the connection.
- Source storage for Google Drive / Dropbox connections in the backend.
- An existing invalid-token backend test for the Google Drive connection endpoint.

This means Google Drive OAuth is **partially implemented already** rather than missing from scratch.

## Gaps to verify / repair before production-ready status

### OAuth lifecycle

- Verify production Google OAuth client IDs are configured for web/Android/iOS as applicable.
- Verify redirect URIs match the live web/mobile environments.
- Add/verify explicit disconnect and revoke flow.
- Verify expired/revoked access tokens surface a clear reconnect state.
- Determine whether refresh tokens are supported; current frontend flow visibly obtains an access token, but long-lived connection behaviour still needs proving.
- Store any long-lived tokens server-side only and never expose them in browser/local storage.
- Ensure source records are scoped to the authenticated Smart Cleaner user.

### Permission minimisation

Current Drive hook requests full `https://www.googleapis.com/auth/drive` access. Review whether narrower scopes can support the intended scan/organise workflow. If destructive or write actions require broader access, explain that clearly during consent and keep mutations explicitly approval-gated.

### Cleaning workflow

Target pipeline:

**Login → connect storage → scan → classify → duplicate/near-duplicate analysis → organisation suggestions → preview → explicit user approval → permitted move/rename/archive/delete → verify → history/undo**

Required capabilities to verify or add:

- duplicate detection;
- near-duplicate/similarity detection;
- large-file detection;
- stale/old-version detection;
- photo/document categorisation;
- suggested folder structures;
- batch rename/move;
- protected folders and exclusions;
- user rules such as keep newest copy / keep RAW / archive rather than delete;
- preview of every destructive or organisational batch;
- explicit approval before move/rename/delete;
- undo/recovery or safe quarantine where feasible;
- storage-saved estimate;
- change report and history.

## E2E acceptance tests

Treat each stage independently:

1. register/login;
2. account isolation;
3. connect Google Drive;
4. list/scan files;
5. identify duplicates;
6. generate organisation suggestions;
7. preview mutations;
8. approve selected actions;
9. perform only approved actions;
10. verify resulting file state;
11. undo/recover where supported;
12. disconnect/revoke;
13. reconnect after token expiry/revocation;
14. logout/login and verify persisted account-owned state.

Manager Hub should record these separately as Pass / Partial / Fail / Blocked.

## Safety rule

OAuth permission is never permission to auto-delete. Destructive file actions remain explicit user-approved operations.
