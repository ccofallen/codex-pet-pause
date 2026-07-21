# Deploying Codex Pet Pause

[简体中文](DEPLOYMENT.zh-CN.md)

## Requirements

Use Node.js `>=22.12.0` and npm. Start from a clean checkout so the lockfile is respected:

```bash
npm ci
```

## Build once, host anywhere

For a normal site served from the domain root, create the production files with:

```bash
npm run build
```

Upload the contents of `dist/` to any static host. This is a static Vite PWA: no application server or database is required.

## GitHub Pages

This repository includes [the Pages deployment workflow](../.github/workflows/deploy-pages.yml). On every push to `main`, it installs dependencies, runs checks, builds the Pages variant, verifies it, and deploys `dist/`.

In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source. After the workflow succeeds, the site is available at [https://ccofallen.github.io/codex-pet-pause/](https://ccofallen.github.io/codex-pet-pause/).

GitHub Pages hosts this project below `/codex-pet-pause/`, so its workflow runs:

```bash
npm run build:pages
```

That build sets the matching `/codex-pet-pause/` base. Do not upload a root-path build to that subpath.

## Vercel

Create a Vercel project from this repository. Use the following project settings:

- Build Command: `npm run build`
- Output Directory: `dist`

This root-path build is appropriate when the project is served at the domain root. If you intentionally serve it under a Vercel subpath, follow the subpath guidance in [Nginx and other static servers](#nginx-and-other-static-servers) instead.

## Netlify

Create a Netlify site from this repository. Set:

- Build command: `npm run build`
- Publish directory: `dist`

For a root deployment, Netlify can publish the generated files directly. A subpath deployment needs both a matching build base and host-side fallback, as described below.

## Nginx and other static servers

For a root deployment, copy the contents of `dist/` to the server's static directory and configure the single-page-app fallback:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

The block above is for a root deployment only. To host at a custom subpath such as `/breaks/`, build with a matching `VITE_BASE_PATH` through a Vite mode or equivalent configuration, then serve the same prefix with a matching Nginx `location` and fallback. For example, place `VITE_BASE_PATH=/breaks/` in the environment file used by the chosen Vite mode, rebuild, and make the fallback resolve to that subpath's `index.html`. A root build with a subpath fallback—or a subpath build served at the root—will request the wrong asset and navigation paths.

Other static servers need the same two pieces: publish the files from `dist/`, and rewrite client-side routes to the `index.html` for the exact prefix being served.

## Windows, Linux, and macOS notes

The npm commands in this guide work in PowerShell, Command Prompt, macOS Terminal, and Linux shells:

```bash
npm ci
npm run build
```

Prefer a Vite mode or an environment file for `VITE_BASE_PATH` so the configuration is portable; inline environment-variable syntax differs between Windows and POSIX shells. Use forward slashes in the base path, for example `/breaks/`.

## Updating an existing deployment

Pull the intended revision, reinstall dependencies, rebuild, and replace the previously published `dist/` files:

```bash
npm ci
npm run build
```

For GitHub Pages, push the revision to `main` and let the included workflow rebuild and deploy it. Keep the same build base as the published URL; use `npm run build:pages` only for the `/codex-pet-pause/` Pages target.

## HTTPS, notifications, and PWA behavior

Production deployments must use HTTPS. Browsers require a secure context for reliable notifications, service workers, and PWA installation; `localhost` is the local-development exception. Users must also grant notification permission, and browser or operating-system power-saving policies can delay background work.

Reminders run only while the app remains open in a browser context. Closing the tab or browser stops reminders; the PWA does not keep a background reminder process running after the browser has closed.

## Troubleshooting

- **Assets or pages return 404 under a subpath:** rebuild with a `VITE_BASE_PATH` that exactly matches the served prefix and configure that prefix's static location and SPA fallback.
- **Direct navigation returns a server 404:** add the root `try_files` fallback above, or its equivalent for the deployed subpath.
- **Notifications do not appear:** confirm HTTPS, grant permission in the browser, and check system notification and focus settings.
- **An older version remains visible:** refresh after the deployment has finished and clear the site's cached data or unregister its service worker if necessary.
- **The Pages URL is wrong:** confirm Settings → Pages uses GitHub Actions and that the Pages workflow built with `/codex-pet-pause/`.
