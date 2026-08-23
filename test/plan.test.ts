import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { MemoryInput } from "../src/nmem.ts";
import type { ImportOptions } from "../src/options.ts";
import {
  assertSavedPlanMatches,
  discardSavedPlan,
  loadSavedPlan,
  optionsFromSavedPlan,
  savedPlanPath,
  savePlan,
} from "../src/plan.ts";

const options: ImportOptions = {
  apiUrl: "http://127.0.0.1:14242",
  command: "plan",
  includeSensitive: false,
  jobs: 2,
  limit: 10,
  mode: "migrate",
  spaceId: "personal",
  tag: "Project Alpha",
  wikiId: "personal-notes",
};

const memory: MemoryInput = {
  content: "Private body",
  created: "2026-08-15T00:00:00.000Z",
  id: "12345678-1234-5123-8123-123456789abc",
  modified: "2026-08-15T01:00:00.000Z",
  sourceWiki: "private-wiki",
  tags: ["Private tag"],
  title: "Private title",
  wikiId: "personal-notes",
};

test("saved plans contain options and fingerprints without tiddler content", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-plan-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  await mkdir(wikiPath);
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  await savePlan({
    memories: [memory],
    options,
    packageVersion: "0.1.0",
    wikiPath,
  });

  const path = savedPlanPath(wikiPath);
  const source = await readFile(path, "utf8");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.doesNotMatch(source, /Private body|Private title|Private tag/u);

  const plan = await loadSavedPlan(wikiPath, "0.1.0");
  assert.equal(plan.memories.length, 1);
  assert.deepEqual(optionsFromSavedPlan(plan), {
    ...options,
    command: "apply",
  });
  assert.doesNotThrow(() => assertSavedPlanMatches(plan, [memory]));
  assert.doesNotThrow(() =>
    assertSavedPlanMatches(plan, [
      memory,
      { ...memory, id: "other-id", title: "Unplanned" },
    ]),
  );
  assert.throws(() => assertSavedPlanMatches(plan, []), /changed after planning/u);
  assert.throws(
    () =>
      assertSavedPlanMatches(plan, [
        {
          ...memory,
          content: "Changed body",
        },
      ]),
    /changed after planning/u,
  );

  await assert.rejects(
    loadSavedPlan(wikiPath, "0.2.0"),
    /another tiddlynmem version/u,
  );

  const otherWikiPath = resolve(temporaryRoot, "other-wiki");
  const otherPlanPath = savedPlanPath(otherWikiPath);
  await mkdir(resolve(otherWikiPath, ".tiddlynmem"), { recursive: true });
  await cp(path, otherPlanPath);
  await assert.rejects(
    loadSavedPlan(otherWikiPath, "0.1.0"),
    /another TiddlyWiki directory/u,
  );

  await writeFile(path, "{}\n", "utf8");
  await assert.rejects(loadSavedPlan(wikiPath, "0.1.0"), /invalid/u);

  await discardSavedPlan(wikiPath);
  await assert.rejects(loadSavedPlan(wikiPath, "0.1.0"), /No saved plan/u);
});
