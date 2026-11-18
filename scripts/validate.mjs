#!/usr/bin/env node
/**
 * Validates every .glb model in this repository.
 *
 * Three.js fails late and loudly on a corrupt asset - usually in the middle of
 * a scene load, in the browser, on someone else's machine. This script catches
 * the same failures before the file reaches main: bad magic bytes, truncated
 * payloads, a declared length that disagrees with the file size, or an
 * unparsable JSON chunk.
 *
 * Usage:
 *   node scripts/validate.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const IGNORED_DIRS = new Set([".git", ".github", "docs", "scripts", "node_modules"]);

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON" little-endian
const SUPPORTED_VERSION = 2;

/**
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
 * Returns a list of problems found in the file. An empty list means valid.
 *
 * @param {string} absolutePath
 * @returns {string[]}
 */
function inspect(absolutePath) {
  const problems = [];
  const { size } = statSync(absolutePath);

  if (size === 0) {
    return ["file is empty"];
  }
  if (size < 20) {
    return [`file is ${size} bytes, smaller than a GLB header`];
  }

  const bytes = readFileSync(absolutePath);

  if (bytes.readUInt32LE(0) !== GLB_MAGIC) {
    return ["missing glTF magic header"];
  }

  const version = bytes.readUInt32LE(4);
  if (version !== SUPPORTED_VERSION) {
    problems.push(`unsupported glTF version ${version}`);
  }

  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== size) {
    problems.push(`header declares ${declaredLength} bytes but the file is ${size}`);
  }

  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (jsonType !== CHUNK_TYPE_JSON) {
    problems.push("first chunk is not a JSON chunk");
  } else if (20 + jsonLength > size) {
    problems.push(`JSON chunk claims ${jsonLength} bytes but only ${size - 20} remain`);
  } else {
    try {
      const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
      if (!json.asset?.version) {
        problems.push("JSON chunk has no asset.version");
      }
    } catch {
      problems.push("JSON chunk is not valid JSON");
    }
  }

  return problems;
}

const files = collectModels(ROOT).sort((a, b) => a.localeCompare(b, "en"));

if (files.length === 0) {
  console.error("No .glb models found.");
  process.exit(1);
}

let failures = 0;

for (const absolutePath of files) {
  const path = relative(ROOT, absolutePath).split(sep).join("/");
  const problems = inspect(absolutePath);

  if (problems.length === 0) {
    console.log(`ok    ${path}`);
    continue;
  }

  failures += 1;
  console.error(`FAIL  ${path}`);
  for (const problem of problems) {
    console.error(`      - ${problem}`);
  }
}

const summary = `${files.length - failures}/${files.length} models valid`;
if (failures > 0) {
  console.error(`\n${summary}. Fix the files above before merging.`);
  process.exit(1);
}

console.log(`\n${summary}.`);
