import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { MemoryInput } from "./nmem.ts";
import type { ImportMode, ImportOptions } from "./options.ts";

export const SAVED_PLAN_RELATIVE_PATH = ".tiddlynmem/plan.json";
const SAVED_PLAN_FORMAT_VERSION = 2;

interface PlannedMemory {
  fingerprint: string;
  id: string;
}

interface SavedPlanOptions {
  apiUrl: string;
  includeSensitive: boolean;
  jobs: number;
  limit: number | null;
  mode: ImportMode;
  spaceId: string;
  tag: string;
  wikiId: string;
}

export interface SavedPlan {
  createdAt: string;
  formatVersion: number;
  memories: PlannedMemory[];
  options: SavedPlanOptions;
  packageVersion: string;
  wikiFingerprint: string;
}

interface SavePlanInput {
  memories: MemoryInput[];
  options: ImportOptions;
  packageVersion: string;
  wikiPath: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function wikiFingerprint(wikiPath: string): string {
  return hash(resolve(wikiPath).normalize("NFC"));
}

export function memoryFingerprint(memory: MemoryInput): string {
  return hash(
    JSON.stringify({
      content: memory.content,
      created: memory.created,
      id: memory.id,
      modified: memory.modified,
      sourceWiki: memory.sourceWiki,
      tags: memory.tags,
      title: memory.title,
      wikiId: memory.wikiId,
    }),
  );
}

export function memorySyncDigest(
  memory: MemoryInput,
  destination: { apiUrl: string; spaceId: string },
): string {
  return `sha256:${hash(
    JSON.stringify({
      apiUrl: destination.apiUrl,
      memory: memoryFingerprint(memory),
      spaceId: destination.spaceId,
    }),
  )}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isSavedPlan(value: unknown): value is SavedPlan {
  if (!isRecord(value) || !isRecord(value.options)) {
    return false;
  }
  const options = value.options;
  return (
    value.formatVersion === SAVED_PLAN_FORMAT_VERSION &&
    typeof value.createdAt === "string" &&
    typeof value.packageVersion === "string" &&
    typeof value.wikiFingerprint === "string" &&
    typeof options.apiUrl === "string" &&
    typeof options.includeSensitive === "boolean" &&
    isPositiveInteger(options.jobs) &&
    (options.limit === null || isPositiveInteger(options.limit)) &&
    (options.mode === "sync" || options.mode === "migrate") &&
    typeof options.spaceId === "string" &&
    typeof options.tag === "string" &&
    typeof options.wikiId === "string" &&
    Array.isArray(value.memories) &&
    value.memories.every(
      (memory) =>
        isRecord(memory) &&
        typeof memory.id === "string" &&
        typeof memory.fingerprint === "string",
    )
  );
}

export function savedPlanPath(wikiPath: string): string {
  return resolve(wikiPath, SAVED_PLAN_RELATIVE_PATH);
}

export async function discardSavedPlan(wikiPath: string): Promise<void> {
  await rm(savedPlanPath(wikiPath), { force: true });
}

export async function savePlan(input: SavePlanInput): Promise<void> {
  const { memories, options, packageVersion, wikiPath } = input;
  const path = savedPlanPath(wikiPath);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const plan: SavedPlan = {
    createdAt: new Date().toISOString(),
    formatVersion: SAVED_PLAN_FORMAT_VERSION,
    memories: memories.map((memory) => ({
      fingerprint: memoryFingerprint(memory),
      id: memory.id,
    })),
    options: {
      apiUrl: options.apiUrl,
      includeSensitive: options.includeSensitive,
      jobs: options.jobs,
      limit: Number.isFinite(options.limit) ? options.limit : null,
      mode: options.mode,
      spaceId: options.spaceId,
      tag: options.tag,
      wikiId: options.wikiId,
    },
    packageVersion,
    wikiFingerprint: wikiFingerprint(wikiPath),
  };

  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function loadSavedPlan(
  wikiPath: string,
  packageVersion: string,
): Promise<SavedPlan> {
  const path = savedPlanPath(wikiPath);
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (
      isRecord(error) &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error('No saved plan found. Run "tiddlynmem plan" first.');
    }
    throw new Error(`Unable to read saved plan: ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('Saved plan is invalid. Run "tiddlynmem plan" again.', {
      cause: error,
    });
  }
  if (!isSavedPlan(parsed)) {
    throw new Error('Saved plan is invalid. Run "tiddlynmem plan" again.');
  }
  if (parsed.packageVersion !== packageVersion) {
    throw new Error(
      'Saved plan was created by another tiddlynmem version. Run "tiddlynmem plan" again.',
    );
  }
  if (parsed.wikiFingerprint !== wikiFingerprint(wikiPath)) {
    throw new Error(
      'Saved plan belongs to another TiddlyWiki directory. Run "tiddlynmem plan" again.',
    );
  }
  return parsed;
}

export function optionsFromSavedPlan(plan: SavedPlan): ImportOptions {
  return {
    ...plan.options,
    command: "apply",
    limit: plan.options.limit ?? Number.POSITIVE_INFINITY,
  };
}

export function assertSavedPlanMatches(
  plan: SavedPlan,
  memories: MemoryInput[],
): void {
  const currentById = new Map(
    memories.map((memory) => [
      memory.id,
      { fingerprint: memoryFingerprint(memory), id: memory.id },
    ]),
  );
  const current = plan.memories
    .map((memory) => currentById.get(memory.id))
    .filter((memory) => memory !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  const planned = [...plan.memories].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (JSON.stringify(current) !== JSON.stringify(planned)) {
    throw new Error(
      'The TiddlyWiki changed after planning. Run "tiddlynmem plan" again before applying.',
    );
  }
}
