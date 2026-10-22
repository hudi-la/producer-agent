# Error diagnostics

Release: `error-logs-20261004-1`.

- The shared error card reports a diagnostic event and shows its UUID. Browser runtime errors and unhandled rejections report through the same bounded reporter.
- Backend HTTP failures receive an `x-fairwind-request-id` and a structured record. Model stream failures are recorded even though the HTTP status is 200. The brain client and chat stream carry the server request ID into client diagnostics when available.
- Log fields are rebuilt from allowlists: receipt timestamp, optional client occurrence timestamp, UUID, source (client/server), operation category, error category, known machine code, HTTP status, release marker, and optional request UUID. No account identity, raw message, stack, full URL, user prompt, file body, or credential is included in these new diagnostic logs.
- The unauthenticated `/diagnostics/errors` intake can receive sign-in errors. It accepts only POST JSON from the configured origin (local origins only in non-hosted mode), enforces a 2 KB body limit and 120 requests/minute, and exposes no log-reading endpoint. Client claims are marked as client-sourced; they are not authoritative server facts.
- Identical category/operation events are merged within 60 seconds in each browser tab. Queued metadata is restricted to 50 entries in sessionStorage, expires after 24 hours, and retries on reconnect or once per minute. Logging failures do not recursively report. The error reference does not promise that an offline event already reached the server.
- Records are stored at `${FAIRWIND_DATA_DIR}/error-logs/errors.jsonl` (fallback: working directory/error-logs). The directory is private (0700); new files are 0600. Files rotate at 1 MiB with four archives. Hourly cleanup removes records older than 14 days, including old lines in an actively appended file. Older entries can expire sooner due to size limits.
- This is dedicated diagnostics, not a rewrite of all existing application console logs. Direct conversation-text logging in the two chat entry points was removed.

## Production lookup

As a server administrator:

```sh
ssh fairwind@64.23.225.65 'grep -F "<error UUID>" /var/lib/fairwind/error-logs/errors.jsonl*'
```

If a client record contains `requestId`, search for that UUID to find the associated server record. Logs contain categories/codes rather than private content, so a user may still need to describe the steps that led to the problem. No automatic monitoring, messaging, or issue creation is enabled.

## Verification

`node --test src/lib/*.test.js src/i18n/*.test.js brain/errorLog.test.js brain/tenant.test.js`

Covers metadata allowlists, secrets/content omission, deduplication, offline replay, queue limits, expiry, origin checks, body limits, rate limits, disk-write failure, log permissions/rotation, record expiry, and request correlation.
