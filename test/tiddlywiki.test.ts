import assert from "node:assert/strict";
import {
  access,
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NMEM_DIGEST_FIELD,
  NMEM_URI_FIELD,
  NOWLEDGE_MEM_TAG,
  type TiddlerRecord,
} from "../src/core.ts";
import {
  deleteWikiTiddlers,
  loadWiki,
  recordWikiSync,
  tiddlyWikiWorkerEnvironment,
} from "../src/tiddlywiki.ts";

const fixture = resolve(
  fileURLToPath(new URL("./fixtures/wiki", import.meta.url)),
);

function sourceFileSnapshot(record: TiddlerRecord): {
  sourceFileDigest: string;
} {
  assert.ok(record.sourceFileDigest);
  return { sourceFileDigest: record.sourceFileDigest };
}

test("TiddlyWiki workers do not inherit the Memory API key", () => {
  assert.deepEqual(
    tiddlyWikiWorkerEnvironment({
      LANG: "en_US.UTF-8",
      NMEM_API_KEY: "secret",
      PATH: "/usr/bin",
    }),
    {
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin",
    },
  );
});

test("loadWiki transports multiline tiddlers without mixing logs", async () => {
  const { diagnostics, records } = await loadWiki(fixture);
  const record = records.find((item) => item.title === "Multiline");

  assert.ok(record);
  assert.equal(record.text.includes("First line.\n\n! Heading"), true);
  assert.ok(record.html);
  assert.match(record.html, /<h1 class="">Heading<\/h1>/u);
  assert.deepEqual(record.tags, ["Test", "long tag"]);
  assert.deepEqual(diagnostics, []);
});

test("loadWiki filters by tag before returning records", async () => {
  const matching = await loadWiki(fixture, { tag: "long tag" });
  const missing = await loadWiki(fixture, { tag: "Missing" });

  assert.deepEqual(matching.records.map((record) => record.title), ["Multiline"]);
  assert.deepEqual(missing.records, []);
});

test("loadWiki renders only tiddlers eligible for synchronization", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  await cp(fixture, wikiPath, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(wikiPath, "tiddlers", "Draft.tid"),
      "title: Draft\ndraft.of: Original\ntype: text/vnd.tiddlywiki\n\nDraft body.\n",
      "utf8",
    ),
    writeFile(
      resolve(wikiPath, "tiddlers", "Imported.tid"),
      `title: Imported\ntags: ${NOWLEDGE_MEM_TAG}\ntype: text/vnd.tiddlywiki\n\nImported body.\n`,
      "utf8",
    ),
    writeFile(
      resolve(wikiPath, "tiddlers", "Sensitive.tid"),
      "title: API key notes\ntype: text/vnd.tiddlywiki\n\nSensitive body.\n",
      "utf8",
    ),
  ]);
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const defaultLoad = await loadWiki(wikiPath);
  const draft = defaultLoad.records.find((record) => record.title === "Draft");
  const imported = defaultLoad.records.find(
    (record) => record.title === "Imported",
  );
  const sensitive = defaultLoad.records.find(
    (record) => record.title === "API key notes",
  );
  assert.ok(draft);
  assert.ok(imported);
  assert.ok(sensitive);
  assert.equal(draft.html, undefined);
  assert.ok(imported.html);
  assert.equal(sensitive.html, undefined);

  const includedLoad = await loadWiki(wikiPath, { includeSensitive: true });
  const includedSensitive = includedLoad.records.find(
    (record) => record.title === "API key notes",
  );
  assert.ok(includedSensitive?.html);
});

test("recordWikiSync writes sync metadata exactly once", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  await cp(fixture, wikiPath, { recursive: true });
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath);
  const beforeRecord = before.records.find((item) => item.title === "Multiline");
  assert.ok(beforeRecord);

  const syncRecord = {
    digest: `sha256:${"a".repeat(64)}`,
    ...sourceFileSnapshot(beforeRecord),
    title: "Multiline",
    uri: "nowledgemem://memory/12345678-1234-5123-8123-123456789abc",
  };
  const firstResult = await recordWikiSync(wikiPath, [syncRecord]);
  assert.deepEqual(firstResult, [{ status: "written", title: "Multiline" }]);

  const afterFirstWrite = await loadWiki(wikiPath);
  const taggedRecord = afterFirstWrite.records.find(
    (item) => item.title === "Multiline",
  );
  assert.ok(taggedRecord);
  assert.equal(taggedRecord.text, beforeRecord.text);
  assert.equal(taggedRecord.modified, beforeRecord.modified);
  assert.equal(taggedRecord.nmemUri, syncRecord.uri);
  assert.equal(taggedRecord.nmemDigest, syncRecord.digest);
  assert.deepEqual(taggedRecord.tags, ["Test", "long tag", NOWLEDGE_MEM_TAG]);

  const secondResult = await recordWikiSync(wikiPath, [syncRecord]);
  assert.deepEqual(secondResult, [
    { status: "already-current", title: "Multiline" },
  ]);

  const afterSecondWrite = await loadWiki(wikiPath);
  const retaggedRecord = afterSecondWrite.records.find(
    (item) => item.title === "Multiline",
  );
  assert.ok(retaggedRecord);
  assert.equal(
    (Array.isArray(retaggedRecord.tags) ? retaggedRecord.tags : []).filter(
      (tag) => tag === NOWLEDGE_MEM_TAG,
    ).length,
    1,
  );
});

test("recordWikiSync rejects a concurrent source edit without overwriting it", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const tiddlerCount = 200;
  await cp(fixture, wikiPath, { recursive: true });
  await Promise.all(
    Array.from({ length: tiddlerCount }, async (_, index) => {
      const title = `Race ${String(index).padStart(3, "0")}`;
      await writeFile(
        resolve(wikiPath, "tiddlers", `${title}.tid`),
        `title: ${title}\ntags: Race\ntype: text/plain\n\nOriginal body ${index}.\n`,
        "utf8",
      );
    }),
  );
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath, { tag: "Race" });
  const syncRecords = before.records.map((record, index) => ({
    digest: `sha256:${index.toString(16).padStart(64, "0")}`,
    ...sourceFileSnapshot(record),
    title: record.title,
    uri: "nowledgemem://memory/12345678-1234-5123-8123-123456789abc",
  }));
  const firstPath = resolve(wikiPath, "tiddlers", "Race 000.tid");
  const lastTitle = `Race ${String(tiddlerCount - 1).padStart(3, "0")}`;
  const lastPath = resolve(wikiPath, "tiddlers", `${lastTitle}.tid`);
  const syncing = recordWikiSync(wikiPath, syncRecords);

  let firstWriteObserved = false;
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if ((await readFile(firstPath, "utf8")).includes("nmem-digest:")) {
      firstWriteObserved = true;
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  assert.equal(firstWriteObserved, true);
  await writeFile(
    lastPath,
    (await readFile(lastPath, "utf8")).replace(
      `Original body ${tiddlerCount - 1}.`,
      "Concurrent user edit.",
    ),
    "utf8",
  );

  const results = await syncing;
  assert.deepEqual(results.at(-1), {
    error:
      "The source file changed after apply scanning. Run plan again before retrying.",
    status: "failed",
    title: lastTitle,
  });
  const finalSource = await readFile(lastPath, "utf8");
  assert.match(finalSource, /Concurrent user edit\./u);
  assert.doesNotMatch(finalSource, /nmem-digest:/u);
});

test("recordWikiSync reports a missing source tiddler without writing", async () => {
  const result = await recordWikiSync(fixture, [
    {
      digest: `sha256:${"a".repeat(64)}`,
      sourceFileDigest: `sha256:${"b".repeat(64)}`,
      title: "Missing",
      uri: "nowledgemem://memory/12345678-1234-5123-8123-123456789abc",
    },
  ]);

  assert.deepEqual(result, [
    {
      error: "The source tiddler no longer exists.",
      status: "failed",
      title: "Missing",
    },
  ]);
});

test("recordWikiSync does not rewrite an unsupported source file", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const jsonPath = resolve(wikiPath, "tiddlers", "Shared.json");
  const json = `${JSON.stringify(
    [
      { text: "First body", title: "First", type: "text/plain" },
      { text: "Second body", title: "Second", type: "text/plain" },
    ],
    null,
    2,
  )}\n`;
  await cp(fixture, wikiPath, { recursive: true });
  await writeFile(jsonPath, json, "utf8");
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath);
  const first = before.records.find((record) => record.title === "First");
  assert.ok(first);

  const result = await recordWikiSync(wikiPath, [
    {
      digest: `sha256:${"a".repeat(64)}`,
      ...sourceFileSnapshot(first),
      title: "First",
      uri: "nowledgemem://memory/12345678-1234-5123-8123-123456789abc",
    },
  ]);

  assert.deepEqual(result, [
    {
      error: "Refusing to rewrite unsupported source file type application/json.",
      status: "failed",
      title: "First",
    },
  ]);
  assert.equal(await readFile(jsonPath, "utf8"), json);
});

test("recordWikiSync preserves a Markdown file with a metadata sidecar", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const markdownPath = resolve(wikiPath, "tiddlers", "Markdown.md");
  const metadataPath = `${markdownPath}.meta`;
  const markdown = "# Heading\n\nOriginal body.\n";
  await cp(fixture, wikiPath, { recursive: true });
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(
    metadataPath,
    "title: Markdown\ntags: Original\ntype: text/markdown\n",
    "utf8",
  );
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath);
  const markdownRecord = before.records.find(
    (record) => record.title === "Markdown",
  );
  assert.ok(markdownRecord);

  const syncRecord = {
    digest: `sha256:${"b".repeat(64)}`,
    ...sourceFileSnapshot(markdownRecord),
    title: "Markdown",
    uri: "nowledgemem://memory/12345678-1234-5123-8123-123456789abc",
  };
  const result = await recordWikiSync(wikiPath, [syncRecord]);

  assert.deepEqual(result, [{ status: "written", title: "Markdown" }]);
  assert.equal(await readFile(markdownPath, "utf8"), markdown);
  const after = await loadWiki(wikiPath, { tag: NOWLEDGE_MEM_TAG });
  const record = after.records.find((item) => item.title === "Markdown");
  assert.ok(record);
  assert.equal(record.nmemUri, syncRecord.uri);
  assert.equal(record.nmemDigest, syncRecord.digest);
  assert.deepEqual(record.tags, ["Original", NOWLEDGE_MEM_TAG]);
  const metadata = await readFile(metadataPath, "utf8");
  assert.match(metadata, new RegExp(`^${NMEM_URI_FIELD}: `, "mu"));
  assert.match(metadata, new RegExp(`^${NMEM_DIGEST_FIELD}: sha256:`, "mu"));
});

test("deleteWikiTiddlers deletes an unchanged standalone tiddler", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const tiddlerPath = resolve(wikiPath, "tiddlers", "Multiline.tid");
  await cp(fixture, wikiPath, { recursive: true });
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath);
  const record = before.records.find((item) => item.title === "Multiline");
  assert.ok(record);

  const result = await deleteWikiTiddlers(wikiPath, [
    { ...sourceFileSnapshot(record), title: record.title },
  ]);

  assert.deepEqual(result, [{ status: "deleted", title: "Multiline" }]);
  await assert.rejects(access(tiddlerPath));
  const after = await loadWiki(wikiPath);
  assert.equal(
    after.records.some((item) => item.title === "Multiline"),
    false,
  );
});

test("deleteWikiTiddlers deletes a body file and its metadata sidecar", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const markdownPath = resolve(wikiPath, "tiddlers", "Markdown.md");
  const metadataPath = `${markdownPath}.meta`;
  await cp(fixture, wikiPath, { recursive: true });
  await writeFile(markdownPath, "# Heading\n", "utf8");
  await writeFile(
    metadataPath,
    "title: Markdown\ntags: Original\ntype: text/markdown\n",
    "utf8",
  );
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath);
  const record = before.records.find((item) => item.title === "Markdown");
  assert.ok(record);

  const result = await deleteWikiTiddlers(wikiPath, [
    { ...sourceFileSnapshot(record), title: record.title },
  ]);

  assert.deepEqual(result, [{ status: "deleted", title: "Markdown" }]);
  await assert.rejects(access(markdownPath));
  await assert.rejects(access(metadataPath));
});

test("deleteWikiTiddlers rejects a changed source without deleting it", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const tiddlerPath = resolve(wikiPath, "tiddlers", "Multiline.tid");
  await cp(fixture, wikiPath, { recursive: true });
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath);
  const record = before.records.find((item) => item.title === "Multiline");
  assert.ok(record);
  await writeFile(
    tiddlerPath,
    (await readFile(tiddlerPath, "utf8")).replace(
      "First line.",
      "Concurrent edit.",
    ),
    "utf8",
  );

  const result = await deleteWikiTiddlers(wikiPath, [
    { ...sourceFileSnapshot(record), title: record.title },
  ]);

  assert.deepEqual(result, [
    {
      error:
        "The source file changed after apply scanning. Run plan again before retrying.",
      status: "failed",
      title: "Multiline",
    },
  ]);
  assert.match(await readFile(tiddlerPath, "utf8"), /Concurrent edit\./u);
});

test("deleteWikiTiddlers refuses to delete a shared source file", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const jsonPath = resolve(wikiPath, "tiddlers", "Shared.json");
  const json = `${JSON.stringify(
    [
      { text: "First body", title: "First", type: "text/plain" },
      { text: "Second body", title: "Second", type: "text/plain" },
    ],
    null,
    2,
  )}\n`;
  await cp(fixture, wikiPath, { recursive: true });
  await writeFile(jsonPath, json, "utf8");
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const before = await loadWiki(wikiPath);
  const first = before.records.find((record) => record.title === "First");
  assert.ok(first);

  const result = await deleteWikiTiddlers(wikiPath, [
    { ...sourceFileSnapshot(first), title: first.title },
  ]);

  assert.deepEqual(result, [
    {
      error: "Refusing to delete shared source file type application/json.",
      status: "failed",
      title: "First",
    },
  ]);
  assert.equal(await readFile(jsonPath, "utf8"), json);
});
