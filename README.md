# AETE Hot-Dip Galvanizing Tracker

Phases 2–4 add Firebase email/password login, account permissions, server validation, and shared live records. The tracker keeps its Received → Processing → Ready → Dispatched workflow, dashboard, roster, and manager CSV export.

**V1 contains the authenticated shared tracker from Phases 2–6.** The administrator reports publishing the complete tested multiline-text rules to **aete-tracker** and finishing the Authentication domain setup on 2026-10-04. Earlier real local preview checks verified manager access and shared reads; production writes remain untested. Pages CI builds with the public Firebase web configuration. The user approved publishing V1 with production acceptance pending; the deployment replaces the prior device-only demo. See [Phase 5 verification and remaining risks](docs/phase5-validation.md) and [Phase 6 release readiness](docs/phase6-release.md).

## Account permissions

Every login is a Firebase Authentication user. Its permission document is `users/{Authentication UID}` with exactly the intended account access:

```json
{ "role": "manager", "active": true }
```

Supported roles: `manager`, `plant`, `shiftA`, `shiftB`. Missing, inactive, or invalid profiles block access. The browser must receive the role from Firestore's server; a cached role cannot unlock the app. An already server-verified session stays visible read-only during connection loss, preserving open forms; writes require fresh permissions. The profile listener also responds to access revocation and role changes. Logout closes the tracker; the password never enters tracker storage. Firebase uses tab-session authentication persistence to limit lingering logins on shared devices.

Roster entries are staff names used in batch dropdowns. Creating or changing a roster entry does not create an Authentication user or grant any permissions. No default manager PIN or role picker remains.

## Manager setup in the Firebase console

These are instructions for the project administrator; the app cannot perform these writes. Do not give anyone an administrator key or Google password.

1. Open project **aete-tracker** → **Firestore Database** → **Data** → **Start collection**.
2. Set the collection ID to `users`.
3. Create the two documents below, using the Authentication UID as the document ID. Do not use an auto-generated ID.

| Account | Document ID | Fields |
| --- | --- | --- |
| Ishaan | `cJ4UQf2RczM3fYkunn3cgmTvTqw1` | `role`: string `manager`; `active`: boolean `true` |
| Owner | `BM7KVuLhCiUGoCECl4lQlsU6jEy1` | `role`: string `manager`; `active`: boolean `true` |

4. The administrator reports publishing the complete tested shared rules, including Phase 5's multiline-text correction, on 2026-10-04. The earlier login-only rules in `docs/phase2-login.rules` are historical reference. The shared rules permit authorized tracker operations and deny all client account-role writes. See the [Phase 6 release readiness](docs/phase6-release.md).
5. To create a future supervisor account, use **Authentication → Users → Add user**, then create its `users/{UID}` document with the appropriate role and boolean `active`. To revoke tracker access, set `active` to `false`. Console access is governed by the project's Google Cloud IAM permissions, independently of browser rules.

The GitHub Pages workflow copies this public Firebase web configuration into the CI build before compiling; no private Firebase Admin credential belongs in the frontend. Pushing `main` runs the Pages deployment workflow.

## Run locally

```sh
cp .env.example .env.local
npm install
npm run dev
```

The supplied public web-app configuration is in `.env.example`. `.env.local` is ignored by Git. This preview connects login, account permissions, batches, roster, and activity to `aete-tracker`. Tracker reads use live listeners; writes use transactions and server timestamps. A failed save never switches to browser storage. Existing `hdg_*_v4` browser keys are preserved unchanged, and managers can download an exact JSON backup when records are present. No old records are uploaded automatically; empty databases are not seeded. Historical PIN data may remain in the backup, but is no longer used for access.

Every authorized browser sees the same shared tracker. After manager login, add roster names for the relevant shifts. Accounts for plant and shift supervisors still need separate Authentication and permission setup.

## Tests

```sh
npm test
npm run build
npm run test:rules
```

`npm test` includes 15 passing unit tests and checks CSV formula protection/numeric balances, role validation, logout/account-switch races, access revocation, cached permission rejection, configuration, read-only offline sessions, shared-save guards, explicit retry journals, legacy backup preservation, and numeric validation. Emulator integration tests are skipped by that command when emulators are absent. `npm run test:rules` starts isolated Auth/Firestore emulators in project **demo-aete**, runs the account, batch, activity, roster, concurrency, SDK login/logout/revocation, and actual shared adapter/live listener tests, then stops them. It does not connect to the real project. Use JDK 21 for the installed Firestore emulator. On this Mac:

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home PATH=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin:$PATH npm run test:rules
```

For an entirely emulated UI, set `VITE_FIREBASE_USE_EMULATOR=true` in `.env.local` and start `npm run dev:emulator`. A separate preview can instead use environment overrides without editing the real preview configuration. Both Auth and Firestore use **demo-aete** in this mode, regardless of the real project configured in the file. Run `npm run firebase:seed` explicitly in another terminal to create disposable emulator accounts and a roster (no batches). The script uses loopback endpoints and the fixed **demo-aete** project only. Emulator emails are `manager@aete.test`, `plant@aete.test`, `shifta@aete.test`, and `shiftb@aete.test`, with the emulator-only password `demo-aete-only-2026`. Production rejects emulator mode at runtime. Restore `false` before testing real login.

The optional `firebase:reset` command preserves emulator state in `.firebase-data`; it also uses **demo-aete** explicitly. Neither command initializes the real project. Automatic seeding has been removed.

## Phase status

- Phases 3–4: implemented and emulator-tested; shared rules published by the administrator on 2026-10-03. Real local manager access and shared reads were verified; real write acceptance remains untested.
- Phase 5: completed locally. Full npm audit fell from 22 affected packages (including one critical) to five development-tool packages (two moderate, three high), with zero runtime-only findings. See the detailed validation report for scoped overrides and remaining tooling limitations.
- Phase 6: production rules publication and domain setup are reported complete. V1 publication is authorized with acceptance pending. Pages CI builds with the public Firebase web configuration; deployed sign-in/read checks and synthetic production write acceptance remain release acceptance gates. See [Phase 6 release readiness](docs/phase6-release.md).

Reference: [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth), [Firestore role-based access](https://firebase.google.com/docs/firestore/solutions/role-based-access), and [Firestore listeners](https://firebase.google.com/docs/firestore/query-data/listen).
