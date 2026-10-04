# Fairwind error UI audit

Implemented in the `workshop-edition` working tree.

## Shared presentation

`ErrorNotice` shows a readable category, affected operation, and next steps. Raw diagnostic details are expandable and redact recognizable credentials, authorization headers, URL credentials, and query strings. Chinese and English are supported. Unknown failures retain their specific message visibly. Read-only retries are offered where safe; writes, sends and restores are never automatically retried.

`ErrorCenter` keeps failures from background reads and actions outside forms visible until dismissed and deduplicates identical notices. Existing inline notices in editing, attachments, conversations and model forms use the same component.

## Audited paths and fixes

- Settings, model keys, subscription tokens: typed HTTP/network/response failures; preserve edits after failure; language changes reload only after a successful save.
- Claude / ChatGPT sign-in: show initial status failures, login failures and code-submission failures; transient service failures do not mark hosted subscriptions permanently unsupported.
- Google / account sessions: display OAuth callback failures and session/profile loading failures; retry the auth gate instead of misdirecting an unavailable local service to first-run setup; surface sign-out and account-switch failures.
- MCP / Bridge: report tool-list loading and installation failures; report clipboard failures; handle token rotation failures. Bridge connection failures produce MCP errors rather than empty tool lists. Credential URLs are converted to Basic auth headers; hosted endpoints are not silently replaced with local discovery. Bridge diagnostics omit credential URLs.
- Backups: list failures differ from “no backups”; export, restore, machine backup and directory-save errors are visible. Partial attachment restoration stays on screen without automatic reload. Network/timeout copy explicitly avoids asserting that a write did not happen.
- Files: upload, attachment registration, download-link creation and deletion errors use readable notices. Batch uploads save each successful entry so a later failure does not hide earlier uploads. Storage cleanup failures are reported separately from successful metadata deletion.
- Models elsewhere: conversation errors, judge preview, per-row judge failures, batch conversation failures and failed stop requests are visible. Failure while reloading after a chat failure no longer prevents restoring the draft.
- Other actions: card changes, reading progress, recipient loading, contact/mail assignment, settings modules, file cleanup and update checks surface previously hidden failures.

## Verification

- All frontend library and translation tests: `node --test src/lib/*.test.js src/i18n/*.test.js`.
- Bridge integration: `node --test brain/mcp-bridge.test.js`, using disposable local servers/databases.
- Production bundle: `npm run build`.
- Browser review with mocked failures: settings read, language/model save, MCP permission denial, malformed backup history, backup export disk-full and update network errors. Verified preserved input, usable buttons, readable cards and redacted key diagnostics.

Live provider outages, real account credentials, production backup restore and real email sending are not exercised by these checks. The change does not deploy or package a release.
