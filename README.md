# AETE Hot-Dip Galvanizing Tracker

React frontend converted from the supplied Claude artifact. It tracks batches through Received, Processing, Ready, and Dispatched; includes the dashboard, roster, manager PIN, and CSV export.

## Run locally

```sh
npm install
npm run dev
```

The app starts with example data on first use. Changes are stored in this browser's local storage and persist across reloads. Each browser/device has its own data; the manager PIN is only a UI gate, not real authentication. The initial demo PIN is `1234`.

## Build

```sh
npm run build
npm run preview
```

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the site when `main` is pushed. In the GitHub repository, choose **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow sets the Vite base path from the repository name. For a manual build at a project URL, set `GITHUB_PAGES_BASE` to `/<repository-name>/`.

Backend synchronization and authentication can replace the local storage module later.
