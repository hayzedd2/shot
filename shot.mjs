#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const POINTER = ".shot.json"; // remembers the active project in the current folder
const MANIFEST = "shot.json"; // lives inside <project>/
// files shot owns inside docs/screenshots — only these are ever deleted
const IMAGE_RE = /^\d{2,}-[^.]+\.(?:png|jpe?g|webp)$/i;
const LEGACY = ["screenshot.png", "screenshot.webp", "screenshot.jpg"];

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
const quiet = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "ignore", ...opts });
const git = (args, cwd) => run("git", args, { cwd });
const has = (cmd) => spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
const status = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const title = (s) => {
  const t = s.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// ---------- active project ----------

function readPointer() {
  const p = path.resolve(POINTER);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    fail(`${POINTER} is not valid JSON`);
  }
}

function writePointer(p) {
  fs.writeFileSync(path.resolve(POINTER), JSON.stringify(p, null, 2) + "\n");
}

function clearPointerIf(project) {
  if (readPointer().project === project) fs.rmSync(path.resolve(POINTER), { force: true });
}

function resolveProject(flags) {
  const name = flags.project ?? readPointer().project;
  if (!name) fail("no active project — run `shot init <project>` or pass --project <name>");
  const project = slugify(name);
  if (!project) fail(`invalid project name: ${name}`);
  return project;
}

const projectDir = (p) => path.resolve(p);

// refuse to treat a random existing folder as a staging area: clear/push delete it
function assertStagingDir(project, flags) {
  const dir = projectDir(project);
  if (!fs.existsSync(dir) || fs.existsSync(path.join(dir, MANIFEST)) || flags.force) return;
  fail(
    `${project}/ already exists and has no ${MANIFEST}.\n` +
      `That doesn't look like a shot folder, and shot deletes project folders when it pushes.\n` +
      `Pick another project name, or pass --force if you really mean ${project}/.`
  );
}

function readProject(project) {
  const f = path.join(projectDir(project), MANIFEST);
  if (!fs.existsSync(f)) return { captures: [] };
  try {
    const m = JSON.parse(fs.readFileSync(f, "utf8"));
    m.captures ??= [];
    return m;
  } catch {
    fail(`${f} is not valid JSON`);
  }
}

function writeProject(project, m) {
  fs.mkdirSync(projectDir(project), { recursive: true });
  fs.writeFileSync(path.join(projectDir(project), MANIFEST), JSON.stringify(m, null, 2) + "\n");
}

// ---------- commands ----------

function init(name, flags) {
  const project = slugify(name);
  if (!project) fail("usage: shot init <project> [--live <url>]");
  assertStagingDir(project, flags);

  const m = readProject(project);
  if (flags.live) m.live = flags.live;
  writeProject(project, m);
  writePointer({ project });

  // keep staging out of the repo you're working in
  if (fs.existsSync(".git")) {
    const missing = [`${project}/`, POINTER].filter((p) => status("git", ["check-ignore", "-q", p]) !== 0);
    if (missing.length) {
      const current = fs.existsSync(".gitignore") ? fs.readFileSync(".gitignore", "utf8") : "";
      const sep = current && !current.endsWith("\n") ? "\n" : "";
      const body = missing.map((p) => `/${p}`).join("\n");
      fs.appendFileSync(".gitignore", `${sep}${current ? "\n" : ""}# shot (local capture area)\n${body}\n`);
      console.log(`Added ${missing.join(", ")} to .gitignore`);
    }
  }

  console.log(`Created ${project}/ — active project is now ${project}`);
}

function use(name) {
  const project = slugify(name);
  if (!fs.existsSync(projectDir(project))) fail(`no such project folder: ${project}/`);
  writePointer({ project });
  console.log(`Active project: ${project}`);
}

function list(flags) {
  const project = resolveProject(flags);
  const m = readProject(project);
  if (!m.captures.length) {
    console.log(`No captures in ${project}/.`);
  } else {
    for (const [i, c] of m.captures.entries()) {
      const ok = fs.existsSync(path.join(projectDir(project), c.file)) ? " " : "?";
      const meta = [c.url, c.caption].filter(Boolean).join(" — ");
      console.log(`${String(i + 1).padStart(2)}.${ok} ${c.file}${meta ? `  (${meta})` : ""}`);
    }
  }
  if (m.live) console.log(`\nlive: ${m.live}`);
}

function remove(name, flags) {
  const project = resolveProject(flags);
  const slug = slugify(name);
  const m = readProject(project);
  const i = m.captures.findIndex((c) => c.slug === slug);
  if (i < 0) fail(`no capture named "${slug}" in ${project}/`);
  fs.rmSync(path.join(projectDir(project), m.captures[i].file), { force: true });
  m.captures.splice(i, 1);
  writeProject(project, m);
  console.log(`Removed ${slug}`);
}

// wipe every screenshot in the project folder, keep the folder + live URL
function clear(flags) {
  const project = resolveProject(flags);
  assertStagingDir(project, flags);
  const m = readProject(project);
  const dir = projectDir(project);
  if (!fs.existsSync(dir)) {
    console.log(`${project}/ is already empty.`);
    return;
  }

  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f === MANIFEST) continue;
    fs.rmSync(path.join(dir, f), { force: true, recursive: true });
    n++;
  }
  m.captures = [];
  writeProject(project, m);

  console.log(`Cleared ${n} file${n === 1 ? "" : "s"} from ${project}/.`);
}

// ---------- capture ----------

function dims(file) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], {
    encoding: "utf8",
  });
  return {
    w: Number(out.match(/pixelWidth:\s*(\d+)/)[1]),
    h: Number(out.match(/pixelHeight:\s*(\d+)/)[1]),
  };
}

// downscale, then WebP if we can, JPEG otherwise
function encode(src, base, { png, width }) {
  const { w } = dims(src);
  if (width && w > width) quiet("sips", ["--resampleWidth", String(width), src]);

  if (png) {
    const out = `${base}.png`;
    if (path.resolve(out) !== path.resolve(src)) fs.renameSync(src, out);
    return "png";
  }

  if (has("cwebp")) {
    try {
      quiet("cwebp", ["-quiet", "-q", "82", src, "-o", `${base}.webp`]);
      fs.rmSync(src, { force: true });
      return "webp";
    } catch {}
  }

  try {
    quiet("sips", ["-s", "format", "webp", "-s", "formatOptions", "82", src, "--out", `${base}.webp`]);
    fs.rmSync(src, { force: true });
    return "webp";
  } catch {
    fs.rmSync(`${base}.webp`, { force: true });
  }

  quiet("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", src, "--out", `${base}.jpg`]);
  fs.rmSync(src, { force: true });
  return "jpg";
}

// "http://localhost:3001/dashboard" -> "dashboard", "/" -> "localhost"
function nameFromUrl(url) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
    const segment = u.pathname.split("/").filter(Boolean).pop();
    return slugify(segment ? segment.replace(/\.[a-z0-9]+$/i, "") : u.hostname.split(".")[0]);
  } catch {
    return slugify(url) || "screenshot";
  }
}

// "localhost:3001", "http://x", "example.com/path" — anything else is a name
const looksLikeUrl = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /[:/]/.test(s) || s.includes(".");

function uniqueSlug(m, base) {
  if (!m.captures.some((c) => c.slug === base)) return base;
  let n = 2;
  while (m.captures.some((c) => c.slug === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function capture(arg1, arg2, flags) {
  const project = resolveProject(flags);
  assertStagingDir(project, flags);
  const m = readProject(project);
  const last = m.captures[m.captures.length - 1];
  const remembered = last?.url ?? m.live;

  // accept both "shot capture <url> [name]" and "shot capture <name> [url]"
  let url, name;
  if (arg1 && looksLikeUrl(arg1)) {
    url = arg1;
    name = arg2;
  } else {
    name = arg1;
    if (arg2 && looksLikeUrl(arg2)) url = arg2;
    else if (arg2) fail(`not a URL: ${arg2}`);
  }

  const app = url ?? remembered;
  if (!app) fail("no app URL yet — first: shot capture <app-url> [name]");

  // explicit name = recapture/replace, derived name = always add
  const explicit = name ? slugify(name) : flags.name ? slugify(flags.name) : undefined;
  const slug = explicit ?? uniqueSlug(m, nameFromUrl(app));

  fs.mkdirSync(projectDir(project), { recursive: true });
  try {
    fs.accessSync(projectDir(project), fs.constants.W_OK);
  } catch {
    fail(`${project}/ is not writable — check permissions and free disk space`);
  }

  // capture into the system temp dir: screencapture is picky about destination
  // folders, and this keeps partial files out of the project folder
  const raw = path.join(os.tmpdir(), `shot-capture-${process.pid}.png`);
  if (flags.from) {
    if (!fs.existsSync(flags.from)) fail(`no such file: ${flags.from}`);
    fs.copyFileSync(flags.from, raw);
  } else {
    if (process.platform !== "darwin") fail("capturing a window needs macOS; use --from <image>");
    console.log(`Click the window showing ${app}…`);
    try {
      run("screencapture", ["-w", "-o", "-x", raw]);
    } catch {
      // still use the file if screencapture wrote one before complaining
    }
    if (!fs.existsSync(raw)) {
      fail(
        [
          "screencapture could not grab a window.",
          "",
          "  1. Give Screen Recording permission to the app running shot:",
          "       System Settings → Privacy & Security → Screen Recording",
          "     then quit and reopen that app (Terminal, iTerm, VS Code, OpenCode…).",
          "  2. Click on the browser window itself — not the desktop, menu bar or Dock.",
          "  3. If the window is fullscreen on another Space, bring it back to this Space first.",
          "  4. Check free disk space with `df -h ~`.",
          "",
          `Already have the image? shot capture ${app} --from <path-to-image>`,
        ].join("\n")
      );
    }
  }

  try {
    let ext;
    try {
      ext = encode(raw, path.join(projectDir(project), slug), {
        png: flags.png,
        width: flags.width,
      });
    } catch {
      fs.rmSync(raw, { force: true });
      fail(`could not write ${project}/${slug}.* — check free disk space and folder permissions`);
    }
    const file = `${slug}.${ext}`;
    for (const e of ["png", "webp", "jpg", "jpeg"]) {
      if (e !== ext) fs.rmSync(path.join(projectDir(project), `${slug}.${e}`), { force: true });
    }

    const i = m.captures.findIndex((c) => c.slug === slug);
    const entry = { slug, file, url: app, at: new Date().toISOString() };
    if (flags.caption) entry.caption = flags.caption;
    if (i >= 0) {
      const [old] = m.captures.splice(i, 1);
      entry.caption ??= old.caption;
    }
    if (flags.hero) m.captures.unshift(entry);
    else if (i >= 0) m.captures.splice(i, 0, entry);
    else m.captures.push(entry);
    writeProject(project, m);

    console.log(`${project}/${file}${entry.caption ? `  — ${entry.caption}` : ""}`);
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

// ---------- push ----------

// only what we touch: README + docs
function clone(repo, dir) {
  try {
    git([
      "clone", "--depth", "1", "--single-branch", "--no-tags",
      "--filter=blob:none", "--sparse", repo, dir,
    ]);
    git(["sparse-checkout", "set", "--no-cone", "/README.md", "/docs/"], dir);
  } catch {
    // older git, or a remote that can't do partial clones
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    git(["clone", "--depth", "1", "--single-branch", "--no-tags", repo, dir]);
  }
}

function push(repo, flags) {
  const project = resolveProject(flags);
  assertStagingDir(project, flags);
  const m = readProject(project);
  const onDisk = (c) => fs.existsSync(path.join(projectDir(project), c.file));
  const missing = m.captures.filter((c) => !onDisk(c));
  if (missing.length) {
    console.log(`Skipping missing file${missing.length === 1 ? "" : "s"}: ${missing.map((c) => c.file).join(", ")}`);
  }
  const captures = m.captures.filter(onDisk);
  if (!captures.length) fail(`nothing in ${project}/ — run shot capture first`);
  const live = flags.live ?? m.live ?? captures[0].url;

  let dir;
  let temp = false;

  try {
    if (fs.existsSync(repo)) {
      dir = path.resolve(repo);
    } else {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
      temp = true;
      clone(repo, dir);
    }

    const outDir = path.join(dir, "docs", "screenshots");
    fs.mkdirSync(outDir, { recursive: true });

    const images = captures.map((c, i) => {
      const ext = path.extname(c.file).slice(1);
      const dest = `docs/screenshots/${String(i + 1).padStart(2, "0")}-${c.slug}.${ext}`;
      fs.copyFileSync(path.join(projectDir(project), c.file), path.join(dir, dest));
      return { ...c, dest };
    });

    // drop images from an earlier push that this slate no longer has
    const wanted = new Set(images.map((img) => path.basename(img.dest)));
    for (const f of fs.readdirSync(outDir)) {
      if (IMAGE_RE.test(f) && !wanted.has(f)) fs.rmSync(path.join(outDir, f));
    }

    const readmePath = path.join(dir, "README.md");
    let readme = fs.existsSync(readmePath)
      ? fs.readFileSync(readmePath, "utf8")
      : `# ${path.basename(repo).replace(/\.git$/, "")}\n`;

    const alt = (img) => title(img.caption ?? img.slug);
    const figure = (img, linked) => {
      const image = `![${alt(img)}](${img.dest})`;
      const markdown = linked && live ? `[${image}](${live})` : image;
      return img.caption ? `**${img.caption}**\n\n${markdown}` : markdown;
    };

    const hero = images[0];
    const parts = [
      ...(flags.title ? [`## ${flags.title}`] : []),
      figure(hero, true),
      ...images.slice(1).map((img) => figure(img, false)),
      ...(live ? [`🔗 [Live demo](${live})`] : []),
    ];
    const block = `<!-- shot:start -->\n${parts.join("\n\n")}\n<!-- shot:end -->`;

    const re = /<!-- shot:start -->[\s\S]*?<!-- shot:end -->/;
    if (re.test(readme)) {
      readme = readme.replace(re, () => block);
    } else {
      const lines = readme.split("\n");
      lines.splice(1, 0, "", block);
      readme = lines.join("\n");
    }
    fs.writeFileSync(readmePath, readme);

    // clean up a single screenshot left by older versions of shot
    const add = ["docs/screenshots", "README.md"];
    for (const f of LEGACY) {
      const p = path.join(dir, "docs", f);
      if (fs.existsSync(p) && !readme.includes(`docs/${f}`)) {
        fs.rmSync(p);
        add.push(`docs/${f}`);
      }
    }

    git(["add", "-A", "--", ...add], dir);
    const changed = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: dir }).status !== 0;
    if (!changed) {
      console.log("No changes, nothing to push.");
    } else {
      const msg = flags.message ?? (images.length === 1 ? "docs: add screenshot" : "docs: add screenshots");
      git(["commit", "-m", msg], dir);
      git(["push"], dir);
    }

    if (flags.keep) {
      console.log(`Kept ${project}/.`);
    } else {
      fs.rmSync(projectDir(project), { recursive: true, force: true });
      clearPointerIf(project);
      console.log(`Cleared ${project}/.`);
    }
  } finally {
    if (temp && dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- CLI ----------

function usage() {
  console.log(`shot — collect screenshots of a WIP app, push them to a repo once

  shot init <project> [--live <url>]    create <project>/, make it active
  shot use <project>                    switch the active project
  shot capture <app-url> [name]         add a screenshot
              <name> [url]              URL optional after the first capture
      --name <name>                     name it (re-capturing a name replaces it)
      --caption <text>                  title shown above the image, also its alt text
      --hero                            move it to the front (first image links to the live URL)
      --from <image>                    use an existing image instead of capturing a window
      --width <px>                      downscale to this width (default 1600, 0 keeps original)
      --png                             keep PNG instead of WebP/JPEG
      --force                           allow using an existing folder that isn't a shot folder
  shot list                             show the active project's slate
  shot rm <name>                        drop a capture
  shot clear                            remove every screenshot in the project folder
  shot push <git-url-or-path>           README + images, one commit, push, clear <project>/
      --title <text>                    heading above the images (e.g. "Screenshots")
      --live <url>                      live demo URL
      --message <text>                  commit message
      --keep                            keep <project>/ after pushing
      --project <name>                  act on this project instead of the active one`);
}

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {};
const pos = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) {
    pos.push(a);
    continue;
  }
  const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (["keep", "png", "hero", "force"].includes(key)) {
    flags[key] = true;
  } else if (argv[i + 1] === undefined) {
    fail(`--${a.slice(2)} needs a value`);
  } else {
    flags[key] = argv[++i];
  }
}

if (cmd === "init") {
  if (!pos[0]) fail("usage: shot init <project> [--live <url>]");
  init(pos[0], flags);
} else if (cmd === "use") {
  if (!pos[0]) fail("usage: shot use <project>");
  use(pos[0]);
} else if (cmd === "capture") {
  const width = flags.width === undefined ? 1600 : Number(flags.width);
  if (!Number.isFinite(width) || width < 0) fail("--width needs a number");
  capture(pos[0], pos[1], { ...flags, width });
} else if (cmd === "push") {
  if (!pos[0]) fail("usage: shot push <git-url-or-path> [options]");
  push(pos[0], flags);
} else if (cmd === "list") {
  list(flags);
} else if (cmd === "rm") {
  if (!pos[0]) fail("usage: shot rm <name>");
  remove(pos[0], flags);
} else if (cmd === "clear") {
  clear(flags);
} else {
  usage();
  if (cmd && cmd !== "help" && cmd !== "--help") process.exit(1);
}
