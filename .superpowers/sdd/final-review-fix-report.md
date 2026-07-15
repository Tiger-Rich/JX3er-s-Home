## Changes

- Hardened prototype bearer tokens with stateless HMAC signing in `server/auth.js`; unsigned and tampered `prototype:*` tokens now fail auth.
- Required a non-empty effective `contactValue` for verification submission in API and UI.
- Re-added `contactValue` only to the authenticated admin verification DTO and rendered it in `AdminVerifications`.

## Tests

- Focused: `npm test -- tests/api.identity.test.js tests/api.requests.test.js tests/ui.permissions.test.jsx`
- Full: `npm test`
- Build: `npm run build`
- E2E: `npm run e2e` passed when rerun by the controller with the required local browser execution permission.

## Commit SHA

- `9c7d068 fix: harden auth and verification contact flow`

## Concerns

- No remaining Critical/Important concerns from the final-review fix pass.

## Feed Discovery V2 Follow-up

### Changes

- Made feed channels and sort controls independent in `src/pages/FeedPage.jsx`, so the selected sort always matches the outgoing query, including `channel=latest&sort=recommended`.
- Normalized SQLite `CURRENT_TIMESTAMP` strings to UTC before calculating freshness in `server/feedDiscovery.js`.
- Added a regression fixture proving an owner's self-heart cannot move an otherwise identical request ahead of a neutral request in `tests/api.requests.test.js`.
- Added UI coverage for Latest channel query/selected-sort alignment and strengthened optimistic reaction coverage for transient count changes and POST/DELETE methods in `tests/ui.permissions.test.jsx`.
- Added timestamp normalization coverage in `tests/feedDiscovery.test.js`.

### Verification

- Focused: `npm test -- tests/ui.permissions.test.jsx tests/api.requests.test.js tests/feedDiscovery.test.js` (143 passed).
- Full: `npm test` (263 passed).
- Build: `npm run build` (passed).

### Deliberately Unresolved

- None.

## Lifecycle Review Fixes (2026-07-16)

### Summary

- Reapplied the verified, active publisher gate to withdrawn-request resubmission and required approved owner verification for admin approval.
- Made admin hard deletion remove request reports and on-disk request images while database cascades remove the remaining request-owned rows.
- Added App-level feed invalidation after owner lifecycle mutations, refreshed My Requests on tab re-entry, removed locally migrated cards from mismatched status filters, and clarified owner-only detail attribution and review reasons.

### Verification

- Focused: `npm test -- tests/api.requests.test.js tests/ui.permissions.test.jsx` (166 passed).
- Build: `npm run build` (passed).

### Concerns

- None.
