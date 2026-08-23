import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
  memoryUri,
  NMEM_DIGEST_FIELD,
  NMEM_URI_FIELD,
  NOWLEDGE_MEM_TAG,
  stableMemoryId,
} from "../src/core.ts";
import { loadWiki } from "../src/tiddlywiki.ts";

interface CommandResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun({ code, stderr, stdout });
    });
  });
}

test("help omits removed compatibility and file-output options", async () => {
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const result = await run("nub", [cliPath, "--help"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: process.env,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /allow-remote/u);
  assert.doesNotMatch(result.stdout, /--report/u);
  assert.doesNotMatch(result.stdout, /--preview-dir/u);
  assert.match(
    result.stdout,
    /Plan options:[\s\S]*--api-url <url>[^\n]*\n\nGlobal options:\n  -h, --help[^\n]*\n  -V, --version/u,
  );
});

test("apply records sync state and updates a changed tiddler", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-cli-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const fixture = fileURLToPath(new URL("./fixtures/wiki", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const memoryRequests: Array<Record<string, unknown>> = [];
  let healthRequests = 0;
  let healthResponseStatus = 200;
  let memoryResponseIncludesId = true;
  let memoryResponseStatus = 200;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      healthRequests += 1;
      response.writeHead(healthResponseStatus, {
        "Content-Type": "application/json",
      });
      response.end(
        healthResponseStatus === 200
          ? '{"services_ready":true,"status":"ok","version":"1.2.3"}'
          : '{"detail":"unavailable"}',
      );
      return;
    }
    request.setEncoding("utf8");
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    if (request.method !== "POST" || request.url !== "/memories") {
      response.writeHead(404).end();
      return;
    }
    const memoryRequest = JSON.parse(body) as Record<string, unknown>;
    memoryRequests.push(memoryRequest);
    response.writeHead(memoryResponseStatus, { "Content-Type": "application/json" });
    response.end(
      memoryResponseStatus === 200
        ? JSON.stringify({
            action: "created",
            memory: memoryResponseIncludesId ? { id: memoryRequest.id } : {},
          })
        : '{"detail":"rejected"}',
    );
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const serverAddress = server.address();
  assert.ok(serverAddress && typeof serverAddress !== "string");
  const apiUrl = `http://127.0.0.1:${serverAddress.port}`;
  await cp(fixture, wikiPath, { recursive: true });
  t.after(async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const tagResult = await run(
    "nub",
    [cliPath, "--tag", "long tag"],
    {
      cwd: wikiPath,
      env: process.env,
    },
  );

  assert.equal(tagResult.code, 0, tagResult.stderr);
  assert.match(tagResult.stdout, /Scanned: 1/u);
  assert.match(tagResult.stdout, /Ready: 1/u);
  assert.match(tagResult.stdout, /\[ready:create\] Multiline/u);
  assert.match(tagResult.stdout, /Source: wiki/u);
  assert.match(tagResult.stdout, /Tags: Test, long tag/u);
  assert.match(tagResult.stdout, /Saved plan: \.tiddlynmem\/plan\.json/u);
  const savedPlanSource = await readFile(
    resolve(wikiPath, ".tiddlynmem", "plan.json"),
    "utf8",
  );
  assert.doesNotMatch(savedPlanSource, /First line|NMEM_API_KEY/u);
  assert.equal(memoryRequests.length, 0);
  assert.equal(healthRequests, 0);

  const planResult = await run(
    "nub",
    [cliPath, "plan", "--tag", "long tag"],
    {
      cwd: wikiPath,
      env: process.env,
    },
  );

  assert.equal(planResult.code, 0, planResult.stderr);
  assert.match(planResult.stdout, /Mode: plan/u);
  assert.equal(memoryRequests.length, 0);
  assert.equal(healthRequests, 0);

  const applyPlanResult = await run(
    "nub",
    [
      cliPath,
      "plan",
      "--api-url",
      apiUrl,
      "--wiki-id",
      "fixture-wiki",
    ],
    {
      cwd: wikiPath,
      env: {
        ...process.env,
        NMEM_API_URL: "http://127.0.0.1:1",
      },
    },
  );
  assert.equal(applyPlanResult.code, 0, applyPlanResult.stderr);

  healthResponseStatus = 503;
  const preflightResult = await run(
    "nub",
    [cliPath, "apply"],
    {
      cwd: wikiPath,
      env: {
        ...process.env,
        NMEM_API_URL: apiUrl,
      },
    },
  );

  assert.equal(preflightResult.code, 1);
  assert.equal(memoryRequests.length, 0);
  assert.match(preflightResult.stdout, /\[failed:preflight\] Multiline/u);
  assert.match(preflightResult.stdout, /Error: .*HTTP 503/u);

  healthResponseStatus = 200;

  memoryResponseIncludesId = false;
  const malformedResult = await run(
    "nub",
    [cliPath, "apply"],
    {
      cwd: wikiPath,
      env: {
        ...process.env,
        NMEM_API_URL: apiUrl,
      },
    },
  );

  assert.equal(malformedResult.code, 1);
  assert.equal(memoryRequests.length, 1);
  assert.match(malformedResult.stdout, /\[failed:import\] Multiline/u);
  assert.match(malformedResult.stdout, /Error: .*valid Memory ID/u);
  const afterMalformedResponse = await loadWiki(wikiPath);
  const stillUntaggedRecord = afterMalformedResponse.records.find(
    (item) => item.title === "Multiline",
  );
  assert.ok(stillUntaggedRecord);
  assert.equal(
    (Array.isArray(stillUntaggedRecord.tags)
      ? stillUntaggedRecord.tags
      : []
    ).includes(NOWLEDGE_MEM_TAG),
    false,
  );

  memoryResponseIncludesId = true;
  memoryResponseStatus = 422;
  const failedResult = await run(
    "nub",
    [cliPath, "apply"],
    {
      cwd: wikiPath,
      env: {
        ...process.env,
        NMEM_API_URL: apiUrl,
      },
    },
  );

  assert.equal(failedResult.code, 1);
  assert.equal(memoryRequests.length, 2);
  assert.match(failedResult.stdout, /\[failed:import\] Multiline/u);
  assert.doesNotMatch(failedResult.stdout, /rejected/u);
  const afterFailedImport = await loadWiki(wikiPath);
  const untaggedRecord = afterFailedImport.records.find(
    (item) => item.title === "Multiline",
  );
  assert.ok(untaggedRecord);
  assert.equal(
    (Array.isArray(untaggedRecord.tags) ? untaggedRecord.tags : []).includes(
      NOWLEDGE_MEM_TAG,
    ),
    false,
  );

  memoryResponseStatus = 200;
  const result = await run(
    "nub",
    [cliPath, "apply"],
    {
      cwd: wikiPath,
      env: {
        ...process.env,
        NMEM_API_URL: "http://127.0.0.1:1",
      },
    },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Imported: 1/u);
  assert.match(result.stdout, /Recorded: 1/u);
  assert.match(result.stdout, /\[imported:create\] Multiline/u);
  assert.match(result.stdout, /Tags: Test, long tag/u);
  assert.match(result.stdout, /Source sync: written/u);
  assert.equal(memoryRequests.length, 3);
  assert.deepEqual(memoryRequests[2], {
    content: [
      "First line.",
      "",
      "# Heading",
      "",
      "Second line with [a link](#Target).",
      "",
    ].join("\n"),
    id: stableMemoryId("fixture-wiki", "Multiline"),
    labels: ["tiddlywiki", "tiddlywiki-wiki", "Test", "long tag"],
    metadata: {
      tiddlywiki_created: "2025-08-10T12:57:15.658Z",
      tiddlywiki_modified: "2025-08-12T07:15:35.863Z",
      tiddlywiki_source: "wiki",
      tiddlywiki_tags: ["Test", "long tag"],
      tiddlywiki_title: "Multiline",
      tiddlywiki_wiki_id: "fixture-wiki",
    },
    source: "tiddlywiki",
    source_app: "tiddlynmem",
    space_id: "default",
    title: "Multiline",
  });

  const { records } = await loadWiki(wikiPath);
  const record = records.find((item) => item.title === "Multiline");
  const importedMemoryId = stableMemoryId("fixture-wiki", "Multiline");
  assert.ok(record);
  assert.deepEqual(record.tags, ["Test", "long tag", NOWLEDGE_MEM_TAG]);
  assert.equal(record.nmemUri, memoryUri(importedMemoryId));
  assert.match(record.nmemDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
  await assert.rejects(
    access(resolve(wikiPath, ".tiddlynmem", "plan.json")),
  );

  const secondPlanResult = await run(
    "nub",
    [
      cliPath,
      "plan",
      "--api-url",
      apiUrl,
      "--wiki-id",
      "fixture-wiki",
    ],
    {
      cwd: wikiPath,
      env: process.env,
    },
  );
  assert.equal(secondPlanResult.code, 0, secondPlanResult.stderr);

  const secondResult = await run(
    "nub",
    [cliPath, "apply"],
    {
      cwd: wikiPath,
      env: {
        ...process.env,
        NMEM_API_URL: apiUrl,
      },
    },
  );

  assert.equal(secondResult.code, 0, secondResult.stderr);
  assert.match(secondResult.stdout, /Ready: 0/u);
  assert.match(
    secondResult.stdout,
    /Skipped: \d+ \(system: \d+, unchanged: 1\)/u,
  );
  assert.match(secondResult.stdout, /Imported: 0/u);
  assert.match(secondResult.stdout, /Recorded: 0/u);
  assert.equal(memoryRequests.length, 3);
  assert.equal(healthRequests, 4);
  assert.match(secondResult.stdout, /\[skipped:unchanged\] Multiline/u);
  assert.match(
    secondResult.stdout,
    /Tags: Test, long tag, \$:\/NowledgeMem/u,
  );

  const destinationPlan = await run(
    "nub",
    [
      cliPath,
      "plan",
      "--api-url",
      apiUrl,
      "--space-id",
      "other-space",
      "--tag",
      "long tag",
      "--wiki-id",
      "fixture-wiki",
    ],
    { cwd: wikiPath, env: process.env },
  );
  assert.equal(destinationPlan.code, 0, destinationPlan.stderr);
  assert.match(destinationPlan.stdout, /\[ready:update\] Multiline/u);

  const tiddlerPath = resolve(wikiPath, "tiddlers", "Multiline.tid");
  const syncedSource = await readFile(tiddlerPath, "utf8");
  const legacySource = syncedSource
    .replace(new RegExp(`^${NMEM_URI_FIELD}:.*\\n`, "mu"), "")
    .replace(new RegExp(`^${NMEM_DIGEST_FIELD}:.*\\n`, "mu"), "");
  await writeFile(tiddlerPath, legacySource, "utf8");

  const migrationPlan = await run(
    "nub",
    [
      cliPath,
      "plan",
      "--api-url",
      apiUrl,
      "--tag",
      "long tag",
      "--wiki-id",
      "fixture-wiki",
    ],
    { cwd: wikiPath, env: process.env },
  );
  assert.equal(migrationPlan.code, 0, migrationPlan.stderr);
  assert.match(migrationPlan.stdout, /\[ready:migrate\] Multiline/u);

  const migrationApply = await run("nub", [cliPath, "apply"], {
    cwd: wikiPath,
    env: process.env,
  });
  assert.equal(migrationApply.code, 0, migrationApply.stderr);
  assert.match(migrationApply.stdout, /\[imported:migrate\] Multiline/u);
  assert.equal(memoryRequests.length, 4);
  assert.equal(memoryRequests[3]?.id, importedMemoryId);

  const migratedSource = await readFile(tiddlerPath, "utf8");
  await writeFile(
    tiddlerPath,
    migratedSource
      .replace("title: Multiline", "title: Renamed")
      .replace("First line.", "Updated line."),
    "utf8",
  );
  const updatePlan = await run(
    "nub",
    [
      cliPath,
      "plan",
      "--api-url",
      apiUrl,
      "--tag",
      "long tag",
      "--wiki-id",
      "fixture-wiki",
    ],
    { cwd: wikiPath, env: process.env },
  );
  assert.equal(updatePlan.code, 0, updatePlan.stderr);
  assert.match(updatePlan.stdout, /\[ready:update\] Renamed/u);

  const updateApply = await run("nub", [cliPath, "apply"], {
    cwd: wikiPath,
    env: process.env,
  });
  assert.equal(updateApply.code, 0, updateApply.stderr);
  assert.match(updateApply.stdout, /\[imported:update\] Renamed/u);
  assert.equal(memoryRequests.length, 5);
  assert.equal(memoryRequests[4]?.id, importedMemoryId);
  assert.equal(memoryRequests[4]?.title, "Renamed");
  assert.match(String(memoryRequests[4]?.content), /^Updated line\./u);
  const updatedWiki = await loadWiki(wikiPath, { tag: "long tag" });
  const updatedRecord = updatedWiki.records.find(
    (item) => item.title === "Renamed",
  );
  assert.ok(updatedRecord);
  assert.equal(updatedRecord.nmemUri, memoryUri(importedMemoryId));
});

test("apply retries only pending Memories after a partial success", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-cli-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const fixture = fileURLToPath(new URL("./fixtures/wiki", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const requestedTitles: string[] = [];
  let failSecond = true;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"services_ready":true,"status":"ok"}');
      return;
    }
    request.setEncoding("utf8");
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    const memoryRequest = JSON.parse(body) as { id: string; title: string };
    requestedTitles.push(memoryRequest.title);
    if (failSecond && memoryRequest.title === "Second") {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end('{"detail":"retry"}');
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ memory: { id: memoryRequest.id } }),
    );
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const serverAddress = server.address();
  assert.ok(serverAddress && typeof serverAddress !== "string");
  const apiUrl = `http://127.0.0.1:${serverAddress.port}`;
  await cp(fixture, wikiPath, { recursive: true });
  await Promise.all(
    ["First", "Second"].map((title) =>
      writeFile(
        resolve(wikiPath, "tiddlers", `${title}.tid`),
        `title: ${title}\ntags: Batch\ntype: text/plain\n\n${title} body.\n`,
        "utf8",
      ),
    ),
  );
  t.after(async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const planResult = await run(
    "nub",
    [cliPath, "plan", "--api-url", apiUrl, "--jobs", "1", "--tag", "Batch"],
    { cwd: wikiPath, env: process.env },
  );
  assert.equal(planResult.code, 0, planResult.stderr);
  assert.match(planResult.stdout, /Ready: 2/u);

  const firstApply = await run("nub", [cliPath, "apply"], {
    cwd: wikiPath,
    env: process.env,
  });
  assert.equal(firstApply.code, 1);
  assert.match(firstApply.stdout, /\[imported:create\] First/u);
  assert.match(firstApply.stdout, /\[failed:import\] Second/u);
  await access(resolve(wikiPath, ".tiddlynmem", "plan.json"));
  const afterPartial = await loadWiki(wikiPath, { tag: "Batch" });
  assert.ok(
    afterPartial.records.find((record) => record.title === "First")?.nmemUri,
  );
  assert.equal(
    afterPartial.records.find((record) => record.title === "Second")?.nmemUri,
    "",
  );

  const requestsBeforeRetry = requestedTitles.length;
  failSecond = false;
  const secondApply = await run("nub", [cliPath, "apply"], {
    cwd: wikiPath,
    env: process.env,
  });
  assert.equal(secondApply.code, 0, secondApply.stderr);
  assert.match(secondApply.stdout, /\[skipped:unchanged\] First/u);
  assert.match(secondApply.stdout, /\[imported:create\] Second/u);
  assert.deepEqual(requestedTitles.slice(requestsBeforeRetry), ["Second"]);
  await assert.rejects(
    access(resolve(wikiPath, ".tiddlynmem", "plan.json")),
  );
});

test("CLI reports its package version outside a Wiki", async () => {
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));

  const result = await run("nub", [cliPath, "--version"], {
    cwd: projectRoot,
    env: process.env,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "0.2.0\n");
});

test("plan reports sanitized media and native API limits without bodies", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-cli-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const fixture = fileURLToPath(new URL("./fixtures/wiki", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  await cp(fixture, wikiPath, { recursive: true });
  const initialPlan = await run("nub", [cliPath, "plan"], {
    cwd: wikiPath,
    env: process.env,
  });
  assert.equal(initialPlan.code, 0, initialPlan.stderr);
  await access(resolve(wikiPath, ".tiddlynmem", "plan.json"));
  await writeFile(
    resolve(wikiPath, "tiddlers", "Markdown.tid"),
    [
      "title: Markdown media",
      "tags: Media",
      "type: text/markdown",
      "",
      "![Local](<local image.png>)",
      "![Embedded](data:image/png;base64,abc)",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    resolve(wikiPath, "tiddlers", "Oversized.tid"),
    [
      "title: Oversized",
      "tags: Media",
      "type: text/plain",
      "",
      "x".repeat(32_769),
      "",
    ].join("\n"),
    "utf8",
  );
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const result = await run(
    "nub",
    [
      cliPath,
      "plan",
      "--tag",
      "Media",
    ],
    { cwd: wikiPath, env: process.env },
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /\[ready:create\] Markdown media/u);
  assert.match(
    result.stdout,
    /Warnings: local:local image\.png; embedded:image\/png/u,
  );
  assert.match(result.stdout, /\[failed:validation\] Oversized/u);
  assert.match(result.stdout, /Error: .*limit of 32768 characters/u);
  assert.doesNotMatch(result.stdout, /Embedded image: Embedded/u);
  assert.doesNotMatch(result.stdout, /base64/u);
  await assert.rejects(access(resolve(temporaryRoot, "previews")));
  await assert.rejects(
    access(resolve(wikiPath, ".tiddlynmem", "plan.json")),
  );
});

test("plan escapes terminal control characters", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-cli-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki\n\u001b[31m");
  const fixture = fileURLToPath(new URL("./fixtures/wiki", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const selectedTag = "Control\u0007Tag";
  await cp(fixture, wikiPath, { recursive: true });
  await writeFile(
    resolve(wikiPath, "tiddlers", "Terminal.tid"),
    [
      "title: Unsafe\u001b[31m title",
      `tags: [[${selectedTag}]]`,
      "type: text/plain",
      "",
      "Body",
      "",
    ].join("\n"),
    "utf8",
  );
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const result = await run(
    "nub",
    [cliPath, "plan", "--tag", selectedTag],
    { cwd: wikiPath, env: process.env },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\u001b|\u0007/u);
  assert.match(result.stdout, /Loading wiki\\n\\u001b\[31m\.\.\./u);
  assert.match(result.stdout, /\[ready:create\] Unsafe\\u001b\[31m title/u);
  assert.match(result.stdout, /Tags: Control\\u0007Tag/u);
  assert.match(result.stdout, /Source: wiki\\n\\u001b\[31m/u);
  assert.match(result.stdout, /Skipped: 0/u);
});

test("apply requires a saved plan", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-cli-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const fixture = fileURLToPath(new URL("./fixtures/wiki", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  await cp(fixture, wikiPath, { recursive: true });
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const result = await run("nub", [cliPath, "apply"], {
    cwd: wikiPath,
    env: process.env,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /No saved plan found/u);
});

test("apply rejects TiddlyWiki drift after planning", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-cli-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const fixture = fileURLToPath(new URL("./fixtures/wiki", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const tiddlerPath = resolve(wikiPath, "tiddlers", "Multiline.tid");
  await cp(fixture, wikiPath, { recursive: true });
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const planResult = await run(
    "nub",
    [cliPath, "plan", "--tag", "long tag"],
    { cwd: wikiPath, env: process.env },
  );
  assert.equal(planResult.code, 0, planResult.stderr);

  const source = await readFile(tiddlerPath, "utf8");
  await writeFile(tiddlerPath, source.replace("First line.", "Changed line."));

  const applyResult = await run("nub", [cliPath, "apply"], {
    cwd: wikiPath,
    env: process.env,
  });

  assert.equal(applyResult.code, 1);
  assert.match(applyResult.stdout, /Mode: apply/u);
  assert.match(applyResult.stdout, /\[ready:create\] Multiline/u);
  assert.match(applyResult.stderr, /changed after planning/u);
});

test("apply prints exact scan failures before rejecting plan drift", async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "tiddlynmem-cli-test-"));
  const wikiPath = resolve(temporaryRoot, "wiki");
  const fixture = fileURLToPath(new URL("./fixtures/wiki", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const tiddlerPath = resolve(wikiPath, "tiddlers", "Multiline.tid");
  await cp(fixture, wikiPath, { recursive: true });
  t.after(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  const planResult = await run(
    "nub",
    [cliPath, "plan", "--tag", "long tag"],
    { cwd: wikiPath, env: process.env },
  );
  assert.equal(planResult.code, 0, planResult.stderr);
  const source = await readFile(tiddlerPath, "utf8");
  await writeFile(
    tiddlerPath,
    source.replace("title: Multiline\n", "title: Multiline\nnmem-digest: invalid\n"),
    "utf8",
  );

  const applyResult = await run("nub", [cliPath, "apply"], {
    cwd: wikiPath,
    env: process.env,
  });

  assert.equal(applyResult.code, 1);
  assert.match(applyResult.stdout, /\[failed:sync-metadata\] Multiline/u);
  assert.match(
    applyResult.stdout,
    /Error: Invalid nmem-digest field: invalid/u,
  );
  assert.match(applyResult.stdout, /Failed: 1/u);
  assert.doesNotMatch(applyResult.stdout, /Importing/u);
  assert.match(applyResult.stderr, /changed after planning/u);
  await access(resolve(wikiPath, ".tiddlynmem", "plan.json"));
});
