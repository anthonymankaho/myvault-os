// Import Obsidian "Second Brain" notes into the MyVault vault.json in anthonymankaho/myvault-data.
// Usage: node tools/import-obsidian.mjs "C:/Users/User/Desktop/Second Brain"
// Idempotent: notes already imported (matched by sourcePath) are skipped on re-runs.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = "anthonymankaho/myvault-data";
const FILE_PATH = "vault.json";
const VAULT_ROOT = process.argv[2] ?? "C:/Users/User/Desktop/Second Brain";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === ".obsidian" || entry === ".trash") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

function uid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { tags: [] };
  const body = match[1];
  const tags = [];
  const inline = body.match(/tags:\s*\[([^\]]*)\]/);
  if (inline) {
    tags.push(...inline[1].split(",").map((t) => t.trim().replaceAll("\"", "")).filter(Boolean));
  } else {
    const listBlock = body.match(/tags:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/);
    if (listBlock) {
      tags.push(...listBlock[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean));
    }
  }
  return { tags };
}

function cleanMarkdown(text) {
  return text
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_-]{1,}(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNote(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const { tags } = parseFrontmatter(raw);
  const links = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim());
  const noFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const heading = noFrontmatter.match(/^#\s+(.+)$/m);
  const title = cleanMarkdown(heading?.[1] ?? "") ||
    cleanMarkdown(filePath.split(/[\\/]/).pop().replace(/\.md$/, ""));

  let summary = "";
  const blocks = noFrontmatter.split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const cleaned = cleanMarkdown(block);
    if (cleaned && !cleaned.startsWith("#") && !cleaned.startsWith("![")) {
      summary = cleaned.length > 220 ? cleaned.slice(0, 220) + "…" : cleaned;
      break;
    }
  }

  const relPath = relative(VAULT_ROOT, filePath).replaceAll("\\", "/");
  const topFolder = relPath.split("/")[0];
  const collection = topFolder === "Skills" ? "skills"
    : topFolder === "Working Projects" ? "projects"
    : "docs";

  return { collection, relPath, item: { title, tags, links, summary } };
}

// --- main ---

const files = walk(VAULT_ROOT);
console.log(`Found ${files.length} markdown files under ${VAULT_ROOT}`);

const fileRes = JSON.parse(
  gh(["api", `repos/${REPO}/contents/${FILE_PATH}`])
);
const sha = fileRes.sha;
const vault = JSON.parse(Buffer.from(fileRes.content.replace(/\s/g, ""), "base64").toString("utf8"));
for (const key of ["skills", "projects", "docs", "cards", "chats"]) {
  if (!Array.isArray(vault[key])) vault[key] = [];
}

const allCollections = [...vault.skills, ...vault.projects, ...vault.docs];
const importedPaths = new Set(allCollections.map((item) => item.sourcePath).filter(Boolean));

let added = 0;
let updated = 0;
let skipped = 0;
for (const file of files) {
  const note = parseNote(file);
  const existingItem = allCollections.find((item) => item.sourcePath === note.relPath);
  if (existingItem) {
    const newLinks = JSON.stringify(note.item.links);
    if (JSON.stringify(existingItem.links ?? []) !== newLinks) {
      existingItem.links = note.item.links;
      updated++;
    } else {
      skipped++;
    }
    continue;
  }
  const base = {
    id: uid(),
    created: new Date().toISOString().slice(0, 10),
    source: "obsidian",
    sourcePath: note.relPath,
    tags: note.tags,
    links: note.item.links,
    notes: note.summary
  };
  if (note.collection === "docs") {
    vault.docs.push({ ...base, title: note.item.title, url: "" });
  } else {
    vault[note.collection].push({ ...base, name: note.item.title,
      ...(note.collection === "projects" ? { status: "Active" } : {}) });
  }
  importedPaths.add(note.relPath);
  added++;
}

console.log(`New: ${added}, links updated: ${updated}, unchanged: ${skipped}`);
if (added === 0 && updated === 0) {
  console.log("Nothing to import.");
  process.exit(0);
}

const content = Buffer.from(JSON.stringify(vault, null, 2), "utf8").toString("base64");
const payload = JSON.stringify({
  message: added > 0
    ? `Import ${added} notes from Obsidian Second Brain`
    : `Refresh links for ${updated} Obsidian notes`,
  content,
  sha
});
execFileSync("gh", ["api", "-X", "PUT", `repos/${REPO}/contents/${FILE_PATH}`,
  "-H", "Accept: application/vnd.github+json",
  "--input", "-"], { input: payload, encoding: "utf8" });
console.log("vault.json updated in GitHub.");
