import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface PackageJson {
  author?: {
    email?: string;
    name?: string;
    url?: string;
  };
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  files?: string[];
  license?: string;
  name?: string;
  private?: boolean;
  publishConfig?: {
    access?: string;
  };
  scripts?: Record<string, string>;
  version?: string;
}

test("package builds and exposes the generated tiddlynmem CLI", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson;

  assert.equal(packageJson.name, "tiddlynmem");
  assert.equal(packageJson.version, "0.2.0");
  assert.deepEqual(packageJson.author, {
    email: "thaddeusjiang@gmail.com",
    name: "Thaddeus Jiang",
    url: "https://github.com/ThaddeusJiang",
  });
  assert.equal(packageJson.license, "Apache-2.0");
  assert.deepEqual(packageJson.bin, { tiddlynmem: "dist/cli.js" });
  assert.deepEqual(packageJson.files, ["dist", "CHANGELOG.md"]);
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.equal(packageJson.devDependencies?.["@nubjs/nub"], "0.7.5");
  assert.equal(packageJson.dependencies?.["@nubjs/nub"], undefined);
  assert.equal(packageJson.scripts?.build, "nub scripts/build-package.ts");
  assert.equal(
    packageJson.scripts?.["check:package"],
    "nub scripts/check-package.ts",
  );
  assert.match(packageJson.scripts?.prepack ?? "", /npm run check:package/u);
  assert.notEqual(packageJson.private, true);
});
