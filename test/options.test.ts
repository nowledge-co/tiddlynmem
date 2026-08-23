import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/options.ts";

test("parseArgs uses safe defaults", () => {
  assert.deepEqual(parseArgs([]), {
    apiUrl: "",
    command: "plan",
    includeSensitive: false,
    jobs: 4,
    limit: Number.POSITIVE_INFINITY,
    mode: "sync",
    spaceId: "default",
    tag: "",
    wikiId: "",
  });
});

test("parseArgs ignores the package runner separator", () => {
  assert.equal(parseArgs(["--", "--limit", "10"]).limit, 10);
});

test("parseArgs accepts explicit plan and apply commands", () => {
  assert.equal(parseArgs(["plan"]).command, "plan");
  assert.equal(parseArgs(["apply"]).command, "apply");
});

test("parseArgs accepts plan controls", () => {
  assert.deepEqual(
    parseArgs([
      "plan",
      "--include-sensitive",
      "--api-url",
      "http://127.0.0.1:14242",
      "--jobs",
      "2",
      "--limit",
      "10",
      "--mode",
      "migrate",
      "--space-id",
      "personal",
      "--tag",
      "Project Alpha",
      "--wiki-id",
      "personal-notes",
    ]),
    {
      apiUrl: "http://127.0.0.1:14242",
      command: "plan",
      includeSensitive: true,
      jobs: 2,
      limit: 10,
      mode: "migrate",
      spaceId: "personal",
      tag: "Project Alpha",
      wikiId: "personal-notes",
    },
  );
});

test("parseArgs rejects invalid numbers and unknown options", () => {
  assert.throws(() => parseArgs(["--jobs", "0"]), /positive integer/u);
  assert.throws(() => parseArgs(["--limit", "no"]), /positive integer/u);
  assert.throws(() => parseArgs(["--tag"]), /requires a value/u);
  assert.throws(() => parseArgs(["--api-url"]), /requires a value/u);
  assert.throws(() => parseArgs(["--wiki-id"]), /requires a value/u);
  assert.throws(() => parseArgs(["--mode"]), /requires a value/u);
  assert.throws(() => parseArgs(["--mode", "copy"]), /sync or migrate/u);
  assert.throws(() => parseArgs(["plan", "apply"]), /Only one command/u);
  assert.throws(() => parseArgs(["--apply"]), /Unknown option/u);
  assert.throws(() => parseArgs(["--allow-remote"]), /Unknown option/u);
  assert.throws(
    () => parseArgs(["--report", "report.json"]),
    /Unknown option/u,
  );
  assert.throws(
    () => parseArgs(["--preview-dir", "/tmp/preview"]),
    /Unknown option/u,
  );
  assert.throws(
    () => parseArgs(["--tag", "one", "--tag", "two"]),
    /only be specified once/u,
  );
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option/u);
  assert.throws(() => parseArgs(["--wiki", "/notes/one"]), /Unknown option/u);
});

test("parseArgs reserves planning options for plan", () => {
  for (const args of [
    ["apply", "--api-url", "http://127.0.0.1:14242"],
    ["apply", "--include-sensitive"],
    ["apply", "--jobs", "2"],
    ["apply", "--limit", "10"],
    ["apply", "--mode", "migrate"],
    ["apply", "--space-id", "personal"],
    ["apply", "--tag", "Project Alpha"],
    ["apply", "--wiki-id", "personal-notes"],
  ]) {
    assert.throws(() => parseArgs(args), /does not accept plan options/u);
  }
});
