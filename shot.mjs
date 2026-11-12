#!/usr/bin/env node
import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: "inherit" });

async function shot({ app, repo, live = app, wait = 1000, click, name = "screenshot" }) {
  // 1. get the repo: use a local folder if it exists, otherwise clone it
  let dir;
  if (fs.existsSync(repo)) {
    dir = path.resolve(repo);
  } else {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
    git(["clone", "--depth", "1", repo, dir]);
  }

  // 2. screenshot the app
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.goto(app, { waitUntil: "networkidle" });
    if (click) await page.click(click);
    await page.waitForTimeout(wait);
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    await page.screenshot({ path: path.join(dir, `docs/${name}.png`) });
  } finally {
    await browser.close();
  }

  // 3. update README between markers (inserted under the title on first run)
  const readmePath = path.join(dir, "README.md");
  let readme = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf8")
    : `# ${path.basename(dir)}\n`;

  const block = `<!-- shot:start -->
[![Screenshot](docs/${name}.png)](${live})

🔗 [Live demo](${live})
<!-- shot:end -->`;

  const re = /<!-- shot:start -->[\s\S]*?<!-- shot:end -->/;
  if (re.test(readme)) {
    readme = readme.replace(re, () => block);
  } else {
    const lines = readme.split("\n");
    lines.splice(1, 0, "", block);
    readme = lines.join("\n");
  }
  fs.writeFileSync(readmePath, readme);

  // 4. commit + push, only if something changed
  git(["add", `docs/${name}.png`, "README.md"], dir);
  const changed = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: dir }).status !== 0;
  if (changed) {
    git(["commit", "-m", "docs: update screenshot"], dir);
    git(["push"], dir);
  } else {
    console.log("No changes, nothing to push.");
  }
}

// ---- CLI ----
const args = process.argv.slice(2);

if (args[0] === "--all") {
  const file = args[1] ?? "projects.json";
  const projects = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const p of projects) {
    console.log(`\n== ${p.repo}`);
    try {
      await shot(p);
    } catch (e) {
      console.error(`Failed: ${e.message}`);
    }
  }
} else {
  const [app, repo, live] = args;
  if (!app || !repo) {
    console.error(
      "usage:\n  shot <app-url> <repo-url-or-local-path> [live-url]\n  shot --all [projects.json]"
    );
    process.exit(1);
  }
  await shot({ app, repo, live });
}
