# AETE Hot-Dip Galvanizing Tracker

React frontend converted from the supplied Claude artifact. It tracks batches through Received, Processing, Ready, and Dispatched; includes the dashboard, roster, manager PIN, and CSV export. Persistence is provided by a small data-service layer with a Firestore emulator adapter and a localStorage adapter.

## Run locally

```sh
npm install
npm run dev
```

The app defaults to Firestore at the local emulator in development. If Firestore is not running, it falls back to localStorage automatically. The manager PIN is only a UI gate, not real authentication. The initial demo PIN is `1234`.

## Local Firebase emulator

The repository does not require a Firebase account or a production project.

```sh
npm install
npm run dev:emulator
```

This starts Vite and the Firestore emulator (including the emulator UI at [http://127.0.0.1:4000](http://127.0.0.1:4000)). The separate commands are useful when debugging:

```sh
npm run firebase:emulators
npm run dev
```

To add reproducible demo data while the emulator is running, run `npm run firebase:seed`. To persist emulator state between runs, use `npm run firebase:reset`; emulator exports are written to `.firebase-data/` and should not be committed.

## Data adapter configuration

Copy `.env.example` to `.env.local` if you want to make the settings explicit. `VITE_DATA_ADAPTER=firebase` is the development default, and `VITE_DATA_ADAPTER=local` forces the existing localStorage behavior. If Firebase fails after data has loaded, the app copies its current data to localStorage before retrying the write there. A failed save stays visible as an error in the tracker. Local data uses the existing `hdg_*_v4` keys.

## Build

```sh
npm run build
npm run preview
```

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the site when `main` is pushed. In the GitHub repository, choose **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow sets the Vite base path from the repository name. For a manual build at a project URL, set `GITHUB_PAGES_BASE` to `/<repository-name>/`.

## Future production Firebase setup

When a real project exists, fill the `VITE_FIREBASE_*` values in a deployment-only environment file, set `VITE_FIREBASE_USE_EMULATOR=false`, add Firebase Authentication, and replace the local-only `firestore.rules` rule with role-based `request.auth` checks. No credentials are committed by this repository, and nothing is deployed by the included scripts.

Troubleshooting: if the emulator port is busy, change `VITE_FIRESTORE_PORT` and the Firestore port in `firebase.json` together; if the emulator cannot start, install a JDK 11+ and rerun `npm run firebase:emulators`; if the app shows demo data after an emulator restart, use `npm run firebase:seed` or switch to `VITE_DATA_ADAPTER=local`. The current environment may not have Java installed, which prevents a local Firestore smoke test but does not affect the browser fallback or build.
