Production source snapshot from fairwind.hudiworks.com, 2026-10-15.

This branch is a backup of deployed source, not a deployment trigger. Runtime source matches source-sha256.json. The SQL files are current function-definition backups, not automatically applied migrations. No environment files, credentials, user mail or databases are included. Existing migration 0168 is preserved. Context source hashes were checked against the live release manifest; 42 tests and tenant-isolation checks passed in the original release, but real model-response evaluation remains pending.

Use server releases for rollback after checking activity and current source hashes. Test with read-only health/assets/auth checks and existing records; do not create emails, run paid models or mutate production data without a concrete user task. No new local server or paid environment is required.
