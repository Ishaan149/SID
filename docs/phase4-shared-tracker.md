# Phase 4: shared tracker integration

Implemented locally on 2026-10-02. No real batch/roster/activity data has been initialized, imported, or changed by these tests; no push/deployment or console rule publication was performed. Update on 2026-10-03: the administrator published the complete Phase 3–4 shared rules to **aete-tracker**. The real local preview then verified manager access and **Shared Firebase data connected.** This confirmed shared reads, not a real write workflow. Phase 5 subsequently adds an unpublished local multiline-text rules correction; see [Phase 5 validation](phase5-validation.md).

## User-visible changes

- Authorized browsers see the same Firebase batches, roster, and recent activity without refreshing. Initial counts and empty states wait for server-confirmed collection reads.
- Connection status is visible. An already verified session can display the last received records read-only while disconnected. New sessions cannot unlock from cached roles. Saves require connected shared data and fresh account permissions.
- Receive/process/ready/dispatch uses the existing role workflow. Dropdown values are roster IDs; each action stores the historical staff name and the separate authenticated account UID. Numbers are validated before saving, and timestamps come from the server.
- Batch revision checks reject forms opened before another supervisor changed or archived a batch. They never silently advance the action to a different stage.
- Every batch change and its immutable activity snapshot commit together in a transaction. A stable event ID identifies the original action.
- Manager archive replaces permanent deletion, requires a reason, removes the batch from active counts, and retains it under Data → Archived. Archived batches cannot be edited/restored. Data → History reads every event for that batch, even beyond the latest 120 dashboard events.
- Manager roster changes use the server's exact schema. Staff deactivation/removal prevents future selection; past names, IDs, and account attribution remain in history. Roster names do not create login accounts.
- Manager CSV export uses the selected active/archived records and includes account attribution and archive details. Spreadsheet formula-like text is escaped.
- Old browser data is never used as a fallback or automatically uploaded. When old keys exist, managers can download an exact raw JSON backup, including malformed records and historical settings. Backup does not overwrite or erase the original keys.

## Save confirmation and retry

Buttons are blocked while a request is running. A slow response shows a waiting message after 15 seconds; it does not report success or start a second operation. Signing out does not cancel a Firebase operation already sent.

Before submission, the request is stored in a journal scoped to Firebase project and account UID. An uncertain outcome retains the original input and request IDs in tab-session storage. Retry previous save checks the immutable activity receipt first; an already committed action is confirmed without another activity document, including after later stages have been completed. Changed form details cannot reuse a receipt to claim a different save. Other writes stay blocked until the original request is resolved. Explicit server rejection clears the journal and leaves the form open.

The journal is a confirmation aid, not an offline data store or automatic replay queue. It contains the submitted tracker fields, not passwords or Auth tokens. It survives a reload in that tab, but normally not closing the tab. If session storage is blocked/full, retry protection remains in memory for that page only. Roster retries use stable IDs and desired states with expected roster snapshots; divergent data produces a conflict.

## Validation

- `npm test`: 13 unit tests passed; emulator groups are skipped when not running.
- `npm run test:rules`: 30 tests passed, no skips. Includes existing server denial/schema/immutability checks plus real Auth clients using the actual adapter and service for live roster/batches, full workflow, cross-shift handoff, server timestamps, receipt replay, archive/history, staff removal, two-supervisor concurrency, offline/reconnect, revocation, and sign-out.
- `npm run build`: passed; the existing large bundle warning remains.
- Browser test with separate plant, shift, and manager tabs: empty database without automatic seeding; receive → processing → ready with one missing piece → dispatch; live updates in the other tab; archive removes active record and retains all five history entries with account attribution.
- Phase 4 CSV export was clicked without a completed automation download event. Phase 5 closed this check by locating and inspecting actual active/archived CSV downloads, including formula protection, Unicode, quoting, numeric balances, archive details, and account UIDs.
- Legacy backup preservation and unavailable-storage behavior are covered by unit tests. Phase 5 also downloaded and checked the browser JSON backup against all four exact synthetic raw strings, including malformed JSON. No production data migration is included.

## Real local preview status and future setup

1. The administrator already published the Phase 3–4 shared rules on 2026-10-03; no further publication was performed in Phase 5. The current local `firestore.rules` includes the Phase 5 multiline-text correction, which awaits approved Phase 6 publication.
2. Keep `docs/phase2-login.rules` as historical reference. The shared rules retain manager-only roster/archive and plant/shift stage permissions; no client can grant account roles.
3. The real-config local preview (`VITE_FIREBASE_USE_EMULATOR=false`) already verified manager access and **Shared Firebase data connected.** The shared tracker was empty; no real test records were created.
4. Sign in as a manager and create roster names for each required shift. The two existing manager profiles remain manager profiles. Supervisor accounts must be separate Authentication users with the corresponding `users/{UID}` role; creating a roster name does not change either manager's permissions.
5. Test a real shared workflow only with administrator-approved records/accounts. Do not upload the earlier browser backup as-is: its schema differs, and migration requires separate mapping and approval.

Phase 5 dependency remediation and validation are complete locally. Do not push `main` or publish the frontend before separate Phase 6 approval.
