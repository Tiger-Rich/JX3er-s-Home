# Task 1 Report: Request Lifecycle Schema and Owner API

## Status

DONE

## Change Summary

- Added `withdrawn` and `closed` request statuses plus lifecycle timestamps.
- Added a legacy SQLite migration that rebuilds old `requests` CHECK constraints while preserving data and related foreign keys.
- Extracted create/update payload normalization into `server/requestPayload.js`.
- Added owner-only request list, detail, withdraw, close, hide, and resubmit endpoints at `/api/my/requests`.
- Kept public feed/detail access limited to active-owner, approved, unexpired, non-owner-hidden requests.
- Added schema, migration, lifecycle, ownership, resubmission, and public-visibility coverage.

## Commit

`bde52bf feat: add owner request lifecycle API`

## Tests

Command: `npm test -- tests/db.test.js tests/api.requests.test.js`

Result: PASS - 2 test files, 83 tests passed.

## Self-Review

- Owner SQL scopes each individual record and transition by `ownerId`; non-owners receive 404 rather than state information.
- Conditional lifecycle updates enforce pending-to-withdrawn, approved-to-closed, and closed-to-hidden transitions.
- Resubmission is limited to withdrawn requests and clears lifecycle/rejection state before returning to pending.
- The legacy migration test verifies existing request values and the `contact_applications` foreign-key target after the table rebuild.

## Concerns

None.

## Review Fix: Resubmission State Restriction

### Review Issue

`PUT /api/my/requests/:id` allowed owners to edit and resubmit requests in both `withdrawn` and `rejected` states. The business rule permits this flow only after an owner withdrawal; rejected and other non-withdrawn states must return HTTP 409.

### Change Summary

- Changed the owner edit/resubmit SQL condition in `server/routes/myRequests.js` to allow only `status = 'withdrawn'`.
- Renamed the lifecycle test and added coverage asserting a direct PUT against a rejected request returns HTTP 409.
- Updated the existing report wording so resubmission is documented as withdrawn-only.

### Tests

Command: `npm test -- tests/api.requests.test.js`

Result: PASS - 1 test file, 61 tests passed.

### Self-Check

- Confirmed withdrawn requests still transition to pending and clear `rejectReason`.
- Confirmed approved and rejected direct PUT requests both return HTTP 409.
- `git diff --check` passed.
- No unrelated files were changed.

### Concerns

None.
