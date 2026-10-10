# AETE Hot-Dip Galvanizing Tracker

The tracker uses Firebase for login and shared live records, with a Received → Processing → Ready → Dispatched workflow, dashboard, roster, and manager CSV export.

**Quick staff entry is implemented locally.** Staff choose Plant, Shift A, or Shift B and enter their name. Firebase creates an anonymous session behind the scenes. A matching active name is reused from that role's roster; a new name is added when needed. The chosen name is fixed for that session's batch actions and appears in history. Staff can leave or switch users from the tracker header. Managers continue to use email/password sign-in with administrator-assigned access. Publish the updated `firestore.rules` and frontend together, and enable **Anonymous** in Firebase Authentication → Sign-in method before using the hosted flow.

**V1 contains the authenticated shared tracker from Phases 2–6.** The administrator reports publishing the complete tested multiline-text rules to **aete-tracker** and finishing the Authentication domain setup on 2026-10-04. Earlier real local preview checks verified manager access and shared reads; production writes remain untested. Pages CI builds with the public Firebase web configuration. The user approved publishing V1 with production acceptance pending; the deployment replaces the prior device-only demo. See [Phase 5 verification and remaining risks](docs/phase5-validation.md) and [Phase 6 release readiness](docs/phase6-release.md).

## Account permissions

Every entry has a Firebase Authentication identity. Quick entry creates a temporary anonymous identity and a staff permission document at `users/{Authentication UID}`. Administrator-assigned manager access uses:

```json
{ "role": "manager", "active": true }
```

Supported roles: `manager`, `plant`, `shiftA`, `shiftB`. Missing, inactive, or invalid profiles block access. The browser must receive the role from Firestore's server; a cached role cannot unlock the app. An already server-verified session stays visible read-only during connection loss, preserving open forms; writes require fresh permissions. The profile listener also responds to access revocation and role changes. Leaving closes the current tracker session. Firebase uses tab-session authentication persistence to limit lingering logins on shared devices.

Roster entries hold staff names. Quick entry reuses an active matching name in the selected shift or creates a new entry. Anonymous users can read roster names for this lookup; they can create only their own staff profile and, when needed, one matching roster entry. They cannot grant manager access, change permissions, or edit other roster records. Staff actions must use the roster name bound to their current quick entry. Managers can still maintain roster names directly. If setup is interrupted, the same anonymous session can retry quick entry. An inactive profile cannot reactivate itself.

## Manager setup in the Firebase console

These are instructions for assigning manager access. Staff quick entry does not need these steps; the app cannot grant manager access. Do not give anyone an administrator key or Google password.

1. Open project **aete-tracker** → **Firestore Database** → **Data** → **Start collection**.
2. Set the collection ID to `users`.
3. Create the two documents below, using the Authentication UID as the document ID. Do not use an auto-generated ID.

| Account | Document ID | Fields |
| --- | --- | --- |
| Ishaan | `cJ4UQf2RczM3fYkunn3cgmTvTqw1` | `role`: string `manager`; `active`: boolean `true` |
| Owner | `BM7KVuLhCiUGoCECl4lQlsU6jEy1` | `role`: string `manager`; `active`: boolean `true` |

4. The administrator reports publishing the complete tested shared rules, including Phase 5's multiline-text correction, on 2026-10-04. The earlier login-only rules in `docs/phase2-login.rules` are historical reference. The shared rules permit authorized tracker operations and deny all client account-role writes. See the [Phase 6 release readiness](docs/phase6-release.md).
5. Enable **Anonymous** under Firebase Authentication → Sign-in method for quick staff entry. To assign a manager, create or select an email/password Authentication user and set its `users/{UID}` document to `role: "manager"` and `active: true` in the console. To revoke tracker access, set `active` to `false`. Console access is governed by the project's Google Cloud IAM permissions, independently of browser rules.

The GitHub Pages workflow copies this public Firebase web configuration into the CI build before compiling; no private Firebase Admin credential belongs in the frontend. Pushing `main` runs the Pages deployment workflow.

## Run locally

```sh
cp .env.example .env.local
npm install
npm run dev
```

The supplied public web-app configuration is in `.env.example`. `.env.local` is ignored by Git. This preview connects login, account permissions, batches, roster, and activity to `aete-tracker`. Tracker reads use live listeners; writes use transactions and server timestamps. A failed save never switches to browser storage. Existing `hdg_*_v4` browser keys are preserved unchanged, and managers can download an exact JSON backup when records are present. No old records are uploaded automatically; empty databases are not seeded. Historical PIN data may remain in the backup, but is no longer used for access.

Every staff or manager session sees the same shared tracker, subject to its role. Managers can maintain additional roster names.

Managers can receive batches and perform every workflow transition using their signed-in account, then use the existing roster, CSV export, and archive views. Manager actions record the manager Authentication UID in the batch and activity history. Staff remain limited to the actions for their selected Plant, Shift A, or Shift B role. Managers can correct job number, customer, parts, input quantities, notes, and (once ready) output quantities on active, dispatched, or archived batches. Each correction requires a reason and atomically appends an immutable activity entry with the previous and corrected batch snapshots, timestamp, and manager UID; stage and archive metadata are preserved. Publish the updated `firestore.rules` and frontend together before using these permissions on the hosted tracker.

## Tests

```sh
npm test
npm run build
npm run test:rules
```

`npm test` checks quick-entry validation, CSV formula protection/numeric balances, role validation, logout/account-switch races, access revocation, cached permission rejection, configuration, read-only offline sessions, shared-save guards, explicit retry journals, legacy backup preservation, and numeric validation. Emulator integration tests are skipped by that command when emulators are absent. `npm run test:rules` starts isolated Auth/Firestore emulators in project **demo-aete**, runs the quick-entry, account, batch, activity, roster, concurrency, SDK login/logout/revocation, and shared adapter/live listener tests, then stops them. It does not connect to the real project. Use JDK 21 for the installed Firestore emulator. On this Mac:

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home PATH=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin:$PATH npm run test:rules
```

For an entirely emulated UI, set `VITE_FIREBASE_USE_EMULATOR=true` in `.env.local` and start `npm run dev:emulator`. A separate preview can instead use environment overrides without editing the real preview configuration. Both Auth and Firestore use **demo-aete** in this mode, regardless of the real project configured in the file. The Auth emulator accepts anonymous sign-in automatically. Run `npm run firebase:seed` explicitly in another terminal to create a disposable manager account and sample roster (no batches). The script uses loopback endpoints and the fixed **demo-aete** project only. The manager email is `manager@aete.test`, with the emulator-only password `demo-aete-only-2026`. Production rejects emulator mode at runtime. Restore `false` before testing real login.

The optional `firebase:reset` command preserves emulator state in `.firebase-data`; it also uses **demo-aete** explicitly. Neither command initializes the real project. Automatic seeding has been removed.

## Phase status

- Phases 3–4: implemented and emulator-tested; shared rules published by the administrator on 2026-10-03. Real local manager access and shared reads were verified; real write acceptance remains untested.
- Phase 5: completed locally. Full npm audit fell from 22 affected packages (including one critical) to five development-tool packages (two moderate, three high), with zero runtime-only findings. See the detailed validation report for scoped overrides and remaining tooling limitations.
- Phase 6: production rules publication and domain setup are reported complete. V1 publication is authorized with acceptance pending. Pages CI builds with the public Firebase web configuration; deployed sign-in/read checks and synthetic production write acceptance remain release acceptance gates. See [Phase 6 release readiness](docs/phase6-release.md).

Reference: [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth), [Firestore role-based access](https://firebase.google.com/docs/firestore/solutions/role-based-access), and [Firestore listeners](https://firebase.google.com/docs/firestore/query-data/listen).
