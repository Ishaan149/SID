# Phase 6: production release readiness

Updated 2026-10-04. V1 publication is authorized with production acceptance pending. Verification below records the pre-publication checks.

## Completed prerequisites

- The administrator reports publishing the complete tested multiline-text rules to **aete-tracker** and completing the Authentication domain setup. No rules were edited or republished in this continuation.
- The Pages workflow copies the public Firebase browser configuration from `.env.example` into `.env.local` before building. It uses the repository-specific `/SID/` base path and a supported Node LTS release. No Firebase Admin credential belongs in the frontend.
- At review time, `main` on GitHub and local HEAD were both `9ea6895932bb07f560c6bc5b08e60e98c08f1315`. The V1 release packages the reviewed Phase 2–6 changes based on that commit.

## Verification in this continuation

- `npm test` on **Node 22.23.1**: 15 passed, zero failed; four emulator groups skipped because this command does not start emulators.
- Pages-configured `npm run build` on Node 22.23.1: passed, with the existing approximately 717 kB bundle warning. Environment values were loaded from `.env.example`; the ignored `.env.local` was not edited.
- The preceding Phase 6 run passed all 32 isolated **demo-aete** emulator tests with no skips. Its successful log was inspected; the unchanged application/rules were not unnecessarily retested here.
- `git diff --check`: passed.
- Fresh registry audits: five development-only affected packages (three high, two moderate), zero runtime findings. Exact responses are [full tree](security/npm-audit-phase6.json) and [runtime](security/npm-audit-phase6-runtime.json).
- Opening [the current Pages site](https://ishaan149.github.io/SID/) shows **Demo data is saved on this device** and the old role picker. It does not yet contain Firebase login, so Pages sign-in/shared-read acceptance must follow source publication.
- Read-only inspection of the authorized Firebase Console found only the two existing Authentication users and manager role documents. Only the `users` collection was listed; no supervisor accounts or roster were available for acceptance.

## Development-tool findings review

The affected paths remain in `firebase-tools` development tooling: `braces` through `chokidar`, inherited `firebase-tools`, `stream-json`, and `re2`. The Pages workflow runs `npm ci` and the Vite build; it does not invoke Firebase CLI deployment, account/database imports, or Hosting regex handling. These paths are not browser runtime dependencies. This scope supports retaining the tested lockfile for this release; it does not certify every Firebase CLI command as safe.

`stream-json` 3.5.0 fixes the reported nested-input denial of service, but CLI 13 imports legacy CommonJS filter/streamer paths. Patched `re2` requires a newer supported runtime than local Node 20. The installed Node 22.23.1 supports current verification; the dependency refresh still needs its own compatibility work. Arbitrary overrides or `npm audit fix --force` were not applied. See [Phase 5's detailed review](phase5-validation.md), [the stream-json maintainer advisory](https://github.com/uhop/stream-json/security/advisories/GHSA-528h-pc64-c93x), and [the node-re2 maintainer advisory](https://github.com/uhop/node-re2/security/advisories/GHSA-j4r3-hg7j-8chg).

## Remaining release gates

1. The user approved choosing acceptance accounts and one clearly synthetic production batch. Use existing `ishaankurmi@gmail.com` as manager and proposed dedicated accounts `plant-acceptance@aete.test`, `shifta-acceptance@aete.test`, and `shiftb-acceptance@aete.test`. These supervisor accounts have not been created in this continuation. The user must choose and enter new passwords directly in Firebase Console. Granting the corresponding tracker roles requires confirmation at the time of the access change. Do not repurpose either manager's role.
2. With the approved accounts and active roster entries, create **one** batch with job number `PH6-ACCEPTANCE-20261004`, customer `SYNTHETIC RELEASE ACCEPTANCE — NOT A CUSTOMER`, parts `Synthetic test material — no physical stock`, and 10 pieces / 25 kg. Receive as plant, process as Shift A, mark ready as Shift B with 10 pieces / 25 kg, dispatch as plant, and archive as manager with a multiline reason identifying release acceptance. Verify server-confirmed saves, live visibility, five attributed history events, and removal from active records. Archive retains the test permanently; no deletion or migration is planned. Record the real batch ID and results only after execution.
3. The user explicitly approved committing and pushing the reviewed source to `main` with live acceptance pending. A push triggers GitHub Pages. The Pages sign-in/read path can only be checked after the updated frontend is deployed. Publication does not complete production acceptance.
4. Confirm the Pages workflow succeeds for the released commit, then verify manager/plant/shift sign-in and **Shared Firebase data connected** on the deployed site. Close the release only after the synthetic workflow and Pages checks actually pass.

No production records, accounts, roster entries, roles, or rules were changed during these pre-publication checks. The Firebase CLI has no authenticated project session and the GitHub CLI token was previously invalid; Git transport successfully read remote `main`. Deployment success must be verified against the actual released commit. Console credentials must not be copied into files or chat.
