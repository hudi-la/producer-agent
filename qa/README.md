# Attachment drawer QA

This harness mounts the production `ArtifactEditor` component with an injected read-only attachment loader. It does not authenticate, write to Fairwind, or submit an application. Run `VITE_HOSTED=1 npm run dev -- --host 127.0.0.1 --port 5193`, then open `/qa/attachment.html`.

The TXT and HTML buttons optionally read these **private, untracked, temporary** fixtures from `public/attachment-qa/`:
- Processing_Fellowship_2027_Review_v2.txt
- Processing_2027_Submission_Record.html

They are deliberately absent from this checkout after validation. Never commit private fixtures or include them in a release build. Other buttons provide synthetic HTML-security, HTTP-error/retry, unsupported-format and delayed-response cases. The harness is not imported by the production entry point.

## Verified 2026-11-01

- Actual Processing attachment bytes: TXT 11735 bytes; HTML 10865 bytes. Production storage returned HTTP 200; both decode as UTF-8.
- Desktop Chrome: TXT Chinese renders correctly; HTML renders as a document with Chinese headings and submission record, not source code.
- HTML synthetic test: scripts, event attributes, forms, meta refresh and link navigation removed; iframe has empty sandbox and restrictive CSP. Host document remains unchanged.
- Existing editor content stays mounted while preview is visible. After actual keyboard input, opening and closing preview restores unsaved text. Browser automation fill alone did not update React state; the preservation check used keyboard input to verify the real interaction.
- Close restores focus; Escape closes preview and restores the attachment trigger.
- Consecutive attachment switching, slow response followed by another attachment, loading indicator, HTTP 403 failure, retry success and direct-file fallback inspected.
- Unsupported format shows a download link and explanation.
- TXT download completed: downloaded file is 11735 bytes and SHA-256 matches the original fixture. Tool download-event waiter timed out; completion was independently confirmed on disk rather than inferred from the click.
- Chrome viewport simulation: 390x844 and 768x1024; page-mode preview widths 390/768, scrollWidth equals clientWidth. Card-drawer mode preview widths 390/480, also without horizontal overflow. Visually checked both HTML and TXT at 390px. This is NOT iOS-device testing.
- `npm test`: 871 passed, 0 failed. Reused installed workshop brain dependencies and allowed local test HTTP listeners; initial missing-dependency/sandbox runs were superseded by the complete successful run.
- `VITE_HOSTED=1 npm run build`: passed. Plain `npm run build` lacks private demo source in this production checkout; hosted build is the applicable mode.
- `git diff --check`: passed. No typecheck script exists in this JavaScript repository.

## Scope and remaining checks

Branch: `codex/attachment-drawer-20261101`; baseline: `7f79239` (local accessibility production checkout). Relevant deployed attachment opening logic was checked against production `App-xliDpgCh.js`. Release preflight: Render reports live commit e905e19b52bb59b754a0463a40b84aab4777def0 (dep-dbhtmjnb9u1s73avgpsg). GitHub refs were freshly fetched; git diff e905e19..7f79239 contains only docs/deployment.md, so the runtime source baseline is unchanged. The separate pending reply-from-ledger branch is not included.

Only local component-harness browser testing used the patched code; the production authenticated attachment list/sign/download chain was read-only checked during diagnosis. Full patched authenticated-site end-to-end testing and iOS Safari remain outstanding. At the end of local validation no commit, push, deployment, production write, permission change, or re-upload had been performed. Subsequent deployment authorization and results are recorded in docs/deployment.md.

The test server is stopped and private fixture copies were removed from both public/ and dist/. Existing user changes outside this isolated checkout were preserved.
