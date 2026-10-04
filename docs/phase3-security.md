# Phase 3: server permissions and validation

Status: implemented locally in `firestore.rules`, tested against disposable **demo-aete** emulators. The administrator published the Phase 3–4 shared rules to **aete-tracker** on 2026-10-03. The Phase 2 login-only rules in `docs/phase2-login.rules` are historical reference. Phase 5 adds a local multiline-text correction to `firestore.rules`; that correction has not been published and remains a Phase 6 action. Phase 4 now integrates these rules through the shared transactional adapter; see [Phase 4 integration](phase4-shared-tracker.md).

## Permission contract

The server reads `users/{request.auth.uid}` and requires boolean `active: true` plus one recognized role. UID values or roles supplied by the browser, URL, roster, or Auth token custom fields do not grant privileges.

| Operation | Permission |
| --- | --- |
| Read own account permission document | Signed-in owner of that UID, including an inactive/unassigned account |
| Read another account document or list accounts | Denied |
| Create/edit/delete account roles | Denied to all clients; console/IAM administrators manage them |
| Read batches, roster, and activity | Any active manager, plant, Shift A, or Shift B account |
| Receive a batch | Plant |
| Received → Processing | Shift A or Shift B |
| Processing → Ready | Shift A or Shift B |
| Ready → Dispatched | Plant |
| Archive at any stage | Manager, with a reason and a paired activity entry |
| Edit an archived batch or restore it | Denied |
| Permanently delete a batch | Denied, including to managers |
| Manage roster entries | Manager |
| Edit/delete an activity entry | Denied, including to managers |
| Legacy settings/PIN, other collections, nested documents | Denied |

A different shift can finish work started by another shift, preserving the current workflow. Each action must select an active roster entry belonging to the caller's plant/shift. Staff names are snapshots checked against roster IDs; duplicate names are not identities. The authenticated UID is recorded separately as the accountable submitter.

All approved roles can read shared batch data, including archived records and history. Manager-only export is a UI workflow, not a way to prevent someone who already has read access from copying data.

## Batch schema for Phase 4

Document path: `batches/{id}`. IDs contain 1–128 ASCII letters, digits, underscores, or hyphens. The stored `id` must match the document ID. Unexpected fields are rejected. Existing browser records have a different schema and must not be uploaded automatically.

Every new batch contains exactly these fields:

| Fields | Requirements |
| --- | --- |
| `id`, `jobNo`, `customer`, `parts` | Matching document ID; nonblank job number ≤80 characters, customer ≤200, parts ≤500 |
| `piecesIn`, `weightIn` | Integer pieces from 0 to 1 billion; numeric weight from 0 to 1 trillion kg |
| `status` | `Received` on creation |
| `receivedStaffId`, `receivedBy`, `receivedShift` | Active roster ID, matching name, and `Plant` |
| `receivedUid` | The signed-in plant user's UID |
| `receivedAt`, `updatedAt` | Firestore server timestamps from the same commit |
| `notes` | String up to 2,000 characters; preserved after creation |
| `version` | Integer `1` on creation; incremented by exactly one per change |
| `archived` | Boolean `false` on creation |
| `lastEventId` | ID of a new activity document written in the same commit |

Later stages add these fields while keeping all earlier fields unchanged:

| Transition | Newly required fields |
| --- | --- |
| Received → Processing | `processStaffId`, `processBy`, `processShift`, `processUid`, `processAt` |
| Processing → Ready | `readyStaffId`, `readyBy`, `readyShift`, `readyUid`, `readyAt`, `piecesOut`, `weightOut` |
| Ready → Dispatched | `dispatchStaffId`, `dispatchBy`, `dispatchShift`, `dispatchUid`, `dispatchAt` |
| Manager archive | `archivedAt`, `archivedUid`, `archiveReason`; set `archived` to `true` and preserve `status` |

Staff names are limited to 120 characters. Shift values are `Plant`, `Shift A`, or `Shift B`, checked against the caller's account role. New action timestamps equal the server commit time and cannot precede the prior action. Output quantities use the same numeric bounds as input quantities. Missing/extra pieces remain permitted so the existing discrepancy flags can detect them; matching counts are not enforced. NaN, Infinity, negative values, numeric strings, and fractional piece counts are denied. Archive reasons must be nonblank strings of up to 500 characters. The Phase 5 local correction accepts line breaks in required text while still rejecting whitespace-only strings; multiline reasons currently require that correction to be published before they work in the real project.

Immutable received fields and earlier stage fields cannot be changed or removed, even by a manager. The rules validate new fields on each transition and restrict the changed-field set; they do not repeatedly validate all immutable history. This stays within Firestore's rule-evaluation limits and lets staff later be renamed/deactivated/removed without rewriting historical batches.

## Atomic activity contract

Document path: `activity/{lastEventId}`. Each mutation must write a **new** event in the same transaction or batched write. Its fields are:

```text
id, batchId, version, at, action, actorUid,
staffId, who, shift, jobNo, beforeStatus, afterStatus, snapshot
```

- `id` matches the event document ID and the batch's `lastEventId`.
- `batchId`, `jobNo`, and `version` match the batch.
- `at` is the server commit time; `actorUid` is the authenticated submitter.
- `snapshot` is the complete resulting batch, including resolved server timestamps. It must equal the resulting batch document.
- `beforeStatus` matches the prior stored stage, or is `null` for a newly received batch. `afterStatus` matches the resulting stage.
- Action values are `Received`, `Into process`, `Ready`, `Dispatched`, or `Archived`.
- For stage actions, `staffId`, `who`, and `shift` match the action's roster identity in the resulting batch.
- For archiving, `staffId` and `shift` are `null`, `who` is `Manager`, and `actorUid` still identifies the actual manager.

The batch rule checks that its paired event is new and has the matching snapshot and prior stage. The activity rule checks that the batch changes to a new revision in the same commit and validates event fields. This reciprocal check prevents batch changes without logs, orphaned/replayed events, reused event IDs, forged snapshots, and incomplete partial saves. Events cannot be edited or deleted after creation.

The implementation follows Firebase's [getAfter validation for atomic writes](https://firebase.google.com/docs/firestore/security/rules-conditions) and [field-change restrictions](https://firebase.google.com/docs/firestore/security/rules-fields).

## Roster contract

`roster/{id}` contains exactly `id`, `name`, `role`, `shift`, and `active`. ID matches the document; `active` is boolean. Roster roles and shifts must match:

| Roster role | Shift |
| --- | --- |
| Plant Supervisor | Plant |
| Shift A Supervisor | Shift A |
| Shift B Supervisor | Shift B |
| Operations Manager | `null` |

Managers may add, edit, deactivate, or remove a roster entry. Historical batch/event snapshots retain the old name and ID after roster edits or removal. Roster operations do not change login permissions. The Phase 4 UI submits this exact schema without adding generic `createdAt` fields.

## Concurrency and integration boundaries

Each action increments the stored revision by exactly one. Stale writes fail instead of overwriting another supervisor's action. The emulator race test starts two independent authenticated client transactions after both have read the same revision; exactly one batch update and one new event persist.

A stale transaction may receive either a transaction retry conflict or a rules `permission-denied`, depending on whether the server checks the stale precondition or security rule first. The Phase 4 adapter reads the latest revision after an error to distinguish a changed batch from a genuine access failure. Do not silently retry the user's action against a different stage, switch to local storage, or generate a second event for an uncertain save.

Phase 4 replaces generic batch updates and separate activity writes with transactions, uses roster IDs and authenticated UIDs, renders Firestore timestamps, adds archive/history handling, and removes the old settings read. Shared tracking is now enabled in the frontend and requires these rules in the real project. No data was copied, uploaded, initialized, or modified in the real project during Phase 3.

Document access in the rules requires several reads per mutation and affects Firestore billing. The normal mutation operates on one batch plus its event; a bulk importer needs separate validation and request-limit planning. Job card numbers are required text, not globally unique keys. Trusted console/Admin SDK operators bypass rules and must validate any manual imports independently.

## Validation

`npm run test:rules` compiles and applies the actual `firestore.rules` inside the local emulators, then sends ordinary SDK requests for:

- Own-account reads, denied role grants/self-promotion, email/password login/logout, and live role revocation.
- Authorized and unauthorized stage actions, including both shift combinations.
- Schema, text, quantity, staff/shift, actor, and timestamp validation.
- Unchanged prior-stage details and history after roster changes.
- Paired writes, forged events, orphaned/replayed events, and event immutability.
- Manager-only archive at every stage, archive immutability, and denied batch deletion.
- Stale versions and a race between two independent clients.
- Denied access for anonymous, missing, inactive, or invalid account roles; closed unknown/nested paths.

The fixture and concurrency helpers are test-only. Passing emulator tests do not confirm production rule publication or deployment. Phase 4 frontend integration is tested separately with the same rules.

Validation recorded on 2026-10-02: `npm run test:rules` reported 22 passing tests with none skipped; `npm test` reported 11 passing unit tests and skipped the three emulator-only test groups, which were run separately; `npm run build` passed with the existing large-bundle warning. `git diff --check` passed. No dependency versions were changed in Phase 3.
