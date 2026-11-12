# shot

Collect screenshots of a work-in-progress app as you click around, then push all of
them to a repo's README in **one** commit.

Every project gets its own staging folder: `shot init perfect10` creates `perfect10/`,
and captures pile up there until you push. Ten screenshots, one commit.

No Playwright, no Chromium, no dependencies — just Node and macOS `screencapture`.

## Setup

```bash
npm link        # optional: gives you a global `shot` command
```

Node 18+ and macOS. Terminal needs **Screen Recording** permission
(System Settings → Privacy & Security → Screen Recording) for window capture —
grant it to the app you run `shot` from, then quit and reopen that app. If
`screencapture` still refuses, `shot capture <url> --from <image>` imports an
existing screenshot instead (⇧⌘4, CleanShot, anything).

## Usage

Keep every project's staging folder in one place, **outside your repos**, so nothing
ever shows up in `git status`:

```bash
mkdir -p ~/shots && cd ~/shots

shot init perfect10 --live https://perfect10.vercel.app
shot capture localhost:3001                  # → ~/shots/perfect10/localhost.jpg
shot capture localhost:3001 --caption "Billing"
shot capture localhost:3001/settings         # → ~/shots/perfect10/settings.jpg
shot list

shot push git@github.com:you/perfect10.git
```

```
~/shots/
├── .shot.json          # remembers the active project
└── perfect10/          # this batch
    ├── shot.json
    ├── localhost.jpg
    ├── localhost-2.jpg
    └── settings.jpg
```

Each `shot capture` asks you to click a window, grabs exactly what you're looking
at (logged in, three clicks deep, modal open — whatever), and drops it in the
project folder. `shot push` uploads them to `docs/screenshots/`, rewrites the README
block, makes a single commit, and pushes.

After a successful push, `~/shots/perfect10/` and the pointer are deleted — only the
empty `~/shots/` container survives, and the next batch starts with another
`shot init <project>`. Use `--keep` if you want to re-push the same batch.

The folder name is your project name — `shot init slate` gives you `slate/`,
`shot init perfect10` gives you `perfect10/`.

Prefer to work next to the code? `cd` into the repo instead; `shot init` then adds
the project folder and `.shot.json` to that repo's `.gitignore` for you. The one
thing to avoid is a shared parent folder *inside* a repo — e.g.
`my-app/screenshots/` — because shot only gitignores what it creates under the
directory you init from, so `screenshots/` itself would show up as untracked.

## Commands

| command | what it does |
| --- | --- |
| `shot init <project> [--live <url>]` | creates `<project>/`, makes it active, and gitignores it when run inside a repo |
| `shot use <project>` | switch the active project |
| `shot capture <url> [name]` | screenshots a window into the active project |
| `shot list` | shows the active project's slate in README order |
| `shot rm <name>` | drops a capture |
| `shot clear` | removes every screenshot in the project folder (keeps `shot.json` and the live URL) |
| `shot push <repo>` | README + images, one commit, push, clear the project folder |

Any command also takes `--project <name>` to act on a project other than the active one.

`init`, `capture`, `clear` and `push` refuse to touch an existing folder that has no
`shot.json` — since `push` deletes the project folder, that guard stops a typo from
pointing shot at a real directory. `--force` overrides it if you really mean it.

The active project is remembered in `./.shot.json`, so you can keep several
staging folders (`perfect10/`, `slate/`, …) side by side and switch with `shot use`.

### Capture options

| flag | meaning |
| --- | --- |
| `--name <name>` | explicit name; re-capturing an existing name replaces it |
| `--caption <text>` | title rendered above the image (and used as its alt text) |
| `--hero` | move it to the front (the first image is linked to the live URL) |
| `--from <image>` | use an existing image instead of capturing a window |
| `--width <px>` | downscale (default 1600, `0` keeps the original) |
| `--png` | lossless PNG instead of WebP/JPEG |

Without `--name`, the name comes from the URL: `localhost:3001` → `localhost`,
`localhost:3001/settings` → `settings`. Capturing the same URL again adds
`localhost-2`, so you can take several screenshots of one page as you click through it.

The URL only has to be given once — it's remembered for later captures, so after
the first one this is enough:

```bash
shot capture billing-page --caption "Billing"
```

### Push options

| flag | meaning |
| --- | --- |
| `--title <text>` | heading above all the images, e.g. `--title "Screenshots"` |
| `--live <url>` | live demo URL (defaults to the one from `init`, then the first capture's URL) |
| `--message <text>` | commit message |
| `--keep` | keep the project folder after a successful push |

## What it writes

Images go to `docs/screenshots/01-dashboard.webp`, `02-settings.webp`, … and the
README gets this block (idempotent — re-pushing replaces it, never stacks):

```md
<!-- shot:start -->
## Screenshots

**Dashboard**

[![Dashboard](docs/screenshots/01-dashboard.webp)](https://perfect10.vercel.app)

**Billing**

![Billing](docs/screenshots/02-billing.webp)

🔗 [Live demo](https://perfect10.vercel.app)
<!-- shot:end -->
```

`## Screenshots` only appears when you pass `--title`; each `**Caption**` line only
appears for captures that have `--caption`. Without captions you just get the images.

Images from an earlier push that are no longer in the slate are deleted, and a
stale `docs/screenshot.png` from older versions is removed once the README stops
linking it. Only files matching `NN-name.(png|jpg|webp)` inside `docs/screenshots/`
are ever touched.

## How it works

1. `capture` runs `screencapture -w -o -x`, downscales with `sips`, and encodes to
   WebP when available (`cwebp`, or `sips` on newer macOS), falling back to JPEG
2. `push` clones the repo shallow + sparse (only `README.md` and `docs/`), copies the
   images in, rewrites the marker block, commits once, pushes, then deletes both the
   temp clone and the project folder
3. Nothing is pushed when the images and README are unchanged
