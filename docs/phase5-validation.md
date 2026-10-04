# Phase 5: security remediation and acceptance checks

Completed locally on 2026-10-03. Earlier uncommitted work is preserved. No commit, push, deployment, production rule publication, account-permission change, real test record, or legacy migration was performed in this phase. All mutating checks used **demo-aete** Auth/Firestore emulators. The real-config preview on port 5174 was left running; a separate port 5175 preview used environment overrides for emulator mode.

## Security audit and dependency changes

The refreshed npm audit reports affected **packages**, including inherited parent findings; these counts are not distinct vulnerabilities.

| Audit | Before | After |
| --- | --- | --- |
| Full dependency tree | 22: 10 moderate, 11 high, 1 critical | 5: 2 moderate, 3 high, 0 critical |
| Runtime dependencies (`--omit=dev`) | Firebase/gRPC chain affected | 0 findings |

Exact registry responses are retained in [before](security/npm-audit-before.json), [after](security/npm-audit-after.json), and [runtime-only](security/npm-audit-runtime.json) audit files. These are a dated snapshot, not a permanent assurance against future advisories.

Firebase **11.10.0**, Vite **6.4.3**, and Firebase CLI **13.35.1** were already installed. Their manifest minimums now match those installed versions; the CLI remains on its 13.35 patch line. No application dependency was forced to another major, and `npm audit fix --force` was not used. In particular, npm's proposed Firebase downgrade to 9.14.0 was rejected.

Targeted, pinned transitive overrides:

| Dependency path | Patched version | Compatibility evidence |
| --- | --- | --- |
| `@firebase/firestore → @grpc/grpc-js` | 1.13.6 | Same gRPC major; real SDK login, listeners, transactions and emulator tests |
| `firebase-tools → tar` | 7.5.22 | Targeted transitive major update; CLI's actual `archiveDirectory` creates a tar archive, which is read back with its resolved tar dependency |
| CLI/Google tooling `uuid` | 11.1.1 | Targeted transitive major update; preserves CommonJS `v4` calls used by CLI, gaxios, google-gax, teeny-request and universal-analytics; smoke calls and CLI/emulators pass |
| `get-uri → basic-ftp` | 6.2.1 | Targeted transitive major update; CommonJS `Client` and the `access`, `lastMod`, `list`, `downloadTo`, `close` methods used by get-uri remain available |
| `firebase-tools → csv-parse` | 7.0.3 | Targeted transitive major update; retains CommonJS `parse()` streaming contract used by auth-import; CLI command loads and parser round-trips synthetic Unicode/quoted/multiline rows |
| `firebase-tools → universal-analytics` | Keep 0.5.3 | Avoids incidental 0.5.4 Node ≥22 requirement; patched UUID override removes its inherited audit finding |

A permanent dependency compatibility test covers the actual CLI archive helper, streaming CSV parser, CommonJS UUID callers and required FTP client methods. No FTP server transfer or real account import is performed by it. The lockfile includes these resolutions, and `npm ls --all` returns success after a clean install. The browser bundle remains approximately 717 kB before gzip; the existing Vite bundle-size warning persists.

Primary vendor references: [gRPC certificate advisory and patched versions](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j), [tar decompression advisory](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw), [tar changes](https://github.com/isaacs/node-tar/blob/main/CHANGELOG.md), [UUID 11.1.1 changes](https://github.com/uuidjs/uuid/blob/v11.1.1/CHANGELOG.md), [basic-ftp 6.2.1 release](https://github.com/patrickjuchli/basic-ftp/releases/tag/v6.2.1), and [CSV parser changes](https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md).

## Necessary fixes found during validation

- CSV formula protection previously escaped every negative value, including computed numeric balances. `src/data/csv.js` now protects text cells while keeping numeric balances such as `-2` numeric. The existing UTF-8 BOM and quote escaping are preserved; record separators are CRLF. A regression test covers formula-like text, leading whitespace, negative/zero numbers, commas, quotes, Unicode and embedded newlines.
- The archive textarea accepts multiline reasons, but Firestore's prior nonblank-text regex rejected them because dot did not span line breaks. The local `firestore.rules` adds the RE2 dot-all flag. Required text still has its original size limits and must contain a non-whitespace character. Emulator tests accept multiline customer/parts/archive text and reject multiline whitespace-only values. The browser archive and immutable history retain the multiline reason.
- A new integration case commits a real transaction, deliberately loses its acknowledgement, reloads the service from the same journal, and retries after another supervisor advances the batch. The original receipt is confirmed, the journal clears, no second batch appears, and the batch has exactly the two expected events. This is a controlled lost-acknowledgement simulation, not a full browser network-failure test.

## Verification

- Clean `npm ci` in a temporary directory under the same **Node 20.18.1 / npm 10.8.2** runtime as the workspace passed; original preview dependencies were left in place. The temporary directory initially selected the machine's Node 23; that install was stopped and replaced with an explicit Node 20 install.
- `npm test`: **15 unit tests passed**, four emulator groups skipped only because that command ran without emulators. Those groups were run separately.
- `npm run test:rules`: **32 tests passed**, no skips, against fresh **demo-aete** Auth/Firestore emulators using JDK 21. Covers login/logout, roles and revocation, direct unauthorized writes, schema/quantities, atomic activity snapshots, cross-shift handoff, version conflicts and concurrent supervisors, uncertain-save replay after service reload, offline/reconnect, roster history, archive immutability and multiline validation.
- One initial clean-install emulator run failed to connect its live listener with a malformed gRPC transport message (`RESOURCE_EXHAUSTED`) and timed out. An identical fresh-emulator rerun passed all 32 tests without code changes. This is recorded as an intermittent emulator transport limitation; no production-write conclusion is drawn from it.
- Workspace and clean-install `npm run build`: passed; existing large-bundle warning remains.
- `npm ls --all` on the clean install and `git diff --check`: passed.
- Browser checks after dependency updates: separate manager/plant accounts log in and connect, plant receives a batch with formula-like customer text and quoted Unicode parts, manager sees the live record and archives it with a multiline reason, and manager/plant logout return to login. Full archived history displays all five stages and the submitting UIDs for the SDK workflow record.
- **Actual downloaded files** were read from disk. Active and archived CSVs contain 24 columns and UTF-8 BOMs; 26 active and six archived emulator records are separated correctly. Formula-like customer/archive text is prefixed safely, numeric `-2` remains numeric, quotes/commas/Unicode/newlines round-trip through a CSV parser, all workflow UIDs are present, and archive reason/time/UID are retained. The test batch appears only in the archive after archiving. Synthetic legacy-only records appear in neither shared CSV.
- JSON backup downloaded in the in-app browser and native Chrome matches all four exact synthetic legacy strings, including malformed activity JSON and historical settings. A second Chrome download after archive confirms every raw value is unchanged. The temporary fixture page was removed. The in-app browser timed out waiting for its download event even though it saved the file; checking the actual files closed that automation limitation.

## Remaining material limitations and Phase 6 boundary

1. Five full-tree findings remain **only in development dependencies**: `braces`, inherited `chokidar`/`firebase-tools`, `stream-json`, and `re2`. Braces has no patched compatible release in the registry snapshot; removing its path requires a validated CLI watcher refresh. The patched stream-json 3 release uses ESM and different source paths; CLI 13 loads its legacy CommonJS filter/streamer paths, so an arbitrary override would break CLI commands. Patched re2 1.27 requires Node ^22.22.2, ^24.15.0 or ≥26; forcing it onto the current Node 20 environment is inappropriate. These are residual tooling risks, not proof that all CLI commands are safe. Auth import, database JSON import, hosting rewrites/native regex handling, FTP transfers and unrelated deployment commands were not accepted end-to-end. A supported Node/CLI refresh needs its own compatibility validation.
2. Node 20 is now [end-of-life](https://nodejs.org/en/about/previous-releases). The local runtime was preserved, not upgraded globally. Phase 6 should use a supported Node release for CI/tooling and review remaining CLI advisories before deployment.
3. The administrator already published the complete Phase 3–4 shared rules to **aete-tracker** on 2026-10-03; the earlier real local preview verified manager access and connected shared **reads**. Phase 5's multiline correction is **local only**. Until separately approved rule publication, multiline required fields/reasons can still be rejected in the real project. No production rule changes were made here.
4. Real shared receive/process/ready/dispatch/archive acceptance still needs explicitly scoped production test accounts/records. Emulator success and a production build do not confirm a real write workflow or Pages build configuration.
5. Phase 6 requires separate approval. Do not push `main` (it triggers Pages), deploy, publish rules, grant account roles, or migrate browser records as a continuation of this phase.
