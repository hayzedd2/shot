# shot

One command to screenshot an app, drop the image into a repo, update its README, then commit and push.

## Setup

```bash
npm install     # also downloads Chromium via Playwright
npm link        # optional: gives you a global `shot` command
```

## Usage

```bash
# deployed app, clone the repo fresh
shot https://myapp.vercel.app https://github.com/you/myapp

# local dev server, repo already on disk, link the live URL in the README
shot http://localhost:3000 . https://myapp.vercel.app

# refresh every project at once
cp projects.example.json projects.json   # edit it
shot --all
```

Without `npm link`, use `node shot.mjs ...` instead of `shot ...`.

## How it works

1. Clones the repo (or uses the local folder)
2. Screenshots the app at 1440x900 (2x) into `docs/screenshot.png`
3. Replaces the block between `<!-- shot:start -->` and `<!-- shot:end -->` in `README.md`, or inserts it under the title the first time
4. Commits and pushes, skipping if nothing changed

## projects.json options

| key | meaning |
| --- | --- |
| `app` | URL to screenshot |
| `repo` | GitHub URL or local path |
| `live` | URL the README links to (defaults to `app`) |
| `click` | selector to click before capturing, e.g. `text=Dashboard` |
| `wait` | ms to wait before capturing (default 1000) |
