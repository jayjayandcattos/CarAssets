#!/usr/bin/env node
/**
 * Generates manifest.json for every .glb model in this repository.
 *
 * The manifest gives the frontend a single, deterministic source of truth for
 * which models exist, where they live, how large they are, and what the GLB
 * header reports. It is intentionally dependency-free so it can run on any
 * machine with Node 18+ and no `npm install` step.
 *
 * Usage:
 *   node scripts/build-manifest.mjs           # write manifest.json
 *   node scripts/build-manifest.mjs --check   # fail if manifest.json is stale
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST_PATH = join(ROOT, "manifest.json");

/** Directories that never contain published models. */
const IGNORED_DIRS = new Set([".git", ".github", "docs", "scripts", "node_modules"]);

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON" little-endian

/**
 * Recursively collects every .glb file below `dir`.
 *
 * @param {string} dir
 * @param {string[]} [found]
 * @returns {string[]}
 */
function collectModels(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        collectModels(join(dir, entry.name), found);
      }
      continue;
    }
    if (entry.name.toLowerCase().endsWith(".glb")) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Parses the header and JSON chunk of a binary glTF file.
 *
 * @param {Buffer} bytes
 * @returns {{ version: number, asset: { version: string | null, generator: string | null }, counts: Record<string, number> }}
 */
function parseGlb(bytes) {
  if (bytes.length < 20) {
    throw new Error("file is smaller than a GLB header");
  }
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error("missing glTF magic header");
  }

  const version = bytes.readUInt32LE(4);
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) {
    throw new Error(`declared length ${declaredLength} does not match file size ${bytes.length}`);
  }

  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (jsonType !== CHUNK_TYPE_JSON) {
    throw new Error("first chunk is not a JSON chunk");
  }

  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const asset = json.asset ?? {};

  return {
    version,
    asset: {
      version: asset.version ?? null,
      generator: asset.generator ?? null,
    },
    counts: {
      scenes: json.scenes?.length ?? 0,
      nodes: json.nodes?.length ?? 0,
      meshes: json.meshes?.length ?? 0,
      materials: json.materials?.length ?? 0,
      textures: json.textures?.length ?? 0,
      images: json.images?.length ?? 0,
      animations: json.animations?.length ?? 0,
      skins: json.skins?.length ?? 0,
    },
  };
}

/**
 * Extracts a source domain from the `__domain.tld` suffix some vendors append
 * to filenames, so provenance survives a rename.
 *
 * @param {string} modelName
 * @returns {string | null}
 */
function extractSource(modelName) {
  const match = modelName.match(/__([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i);
  return match ? match[1].toLowerCase() : null;
}

const files = collectModels(ROOT).sort((a, b) => a.localeCompare(b, "en"));

const models = files.map((absolutePath) => {
  const bytes = readFileSync(absolutePath);
  const parsed = parseGlb(bytes);
  const path = relative(ROOT, absolutePath).split(sep).join("/");
  const model = basename(absolutePath).replace(/\.glb$/i, "");
  const [brand] = path.split("/");

  return {
    brand,
    model,
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source: extractSource(model),
    glb: parsed,
  };
});

const brands = {};
for (const model of models) {
  brands[model.brand] ??= { models: 0, bytes: 0 };
  brands[model.brand].models += 1;
  brands[model.brand].bytes += model.bytes;
}

const manifest = {
  generatedBy: "scripts/build-manifest.mjs",
  modelCount: models.length,
  totalBytes: models.reduce((sum, model) => sum + model.bytes, 0),
  brands,
  models,
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, "utf8") : "";
  if (current !== serialized) {
    console.error("manifest.json is out of date. Run: node scripts/build-manifest.mjs");
    process.exit(1);
  }
  console.log(`manifest.json is up to date (${manifest.modelCount} models).`);
  process.exit(0);
}

writeFileSync(MANIFEST_PATH, serialized, "utf8");
console.log(
  `Wrote manifest.json: ${manifest.modelCount} models, ` +
    `${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB, ${Object.keys(brands).length} brands.`,
);
