import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const entries = await readdir(root, { withFileTypes: true });

const excluded = new Set([
  "android",
  "dist",
  "node_modules",
  "tests",
  "scripts",
  ".git",
]);

for (const entry of entries) {
  if (excluded.has(entry.name)) continue;

  if (
    entry.isDirectory() ||
    entry.name.endsWith(".html") ||
    entry.name === "sw.js" ||
    entry.name === "manifest.webmanifest"
  ) {
    await cp(join(root, entry.name), join(dist, entry.name), {
      recursive: true,
    });
  }
}

// The static HTML app source lives in backend/js; keep the served dist tree complete.
await cp(join(root, "../backend/js"), join(dist, "js"), {
  recursive: true,
  filter: (source) => !source.endsWith(".legal-backup"),
});

console.log("Rixie mobile web assets built in dist/");
