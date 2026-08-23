import { createRequire } from "node:module";
import { tmpdir } from "node:os";

import { NMEM_DIGEST_FIELD, NMEM_URI_FIELD } from "./core.ts";
import {
  sourceFileDigest,
  type TiddlerFileInfo,
} from "./source-file.ts";

interface TiddlyWikiTiddler {
  fields: {
    [key: string]: unknown;
    tags?: string[];
    title: string;
  };
}

interface TiddlyWikiRuntime {
  Tiddler: new (
    ...fieldMaps: Array<TiddlyWikiTiddler | Record<string, unknown>>
  ) => TiddlyWikiTiddler;
  boot: {
    argv: string[];
    boot(callback: () => void): void;
    files: Record<string, TiddlerFileInfo | undefined>;
  };
  utils: {
    deleteTiddlerFile(
      fileInfo: TiddlerFileInfo,
      callback: (error?: Error | null) => void,
    ): void;
    saveTiddlerToFile(
      tiddler: TiddlyWikiTiddler,
      fileInfo: TiddlerFileInfo,
      callback: (error?: Error | string | null) => void,
    ): void;
  };
  wiki: {
    getTiddler(title: string): TiddlyWikiTiddler | undefined;
  };
}

interface SyncRecord {
  digest: string;
  sourceFileDigest: string;
  title: string;
  uri: string;
}

interface SyncRequest {
  records: SyncRecord[];
  tag: string;
  type: "sync";
}

interface DeleteRecord {
  sourceFileDigest: string;
  title: string;
}

interface DeleteRequest {
  records: DeleteRecord[];
  type: "delete";
}

const require = createRequire(import.meta.url);
const { TiddlyWiki } = require("tiddlywiki/boot/boot.js") as {
  TiddlyWiki(): TiddlyWikiRuntime;
};
const wikiPath = process.argv[2];

if (!wikiPath) {
  throw new Error("A TiddlyWiki path is required.");
}

if (!process.send) {
  throw new Error("The TiddlyWiki sync worker requires a Node IPC channel.");
}

function isSyncRecord(value: unknown): value is SyncRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "digest" in value &&
    typeof value.digest === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.digest) &&
    "sourceFileDigest" in value &&
    typeof value.sourceFileDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.sourceFileDigest) &&
    "title" in value &&
    typeof value.title === "string" &&
    "uri" in value &&
    typeof value.uri === "string" &&
    value.uri.length > 0
  );
}

function isSyncRequest(message: unknown): message is SyncRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "sync" &&
    "tag" in message &&
    typeof message.tag === "string" &&
    "records" in message &&
    Array.isArray(message.records) &&
    message.records.every(isSyncRecord)
  );
}

function isDeleteRecord(value: unknown): value is DeleteRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "sourceFileDigest" in value &&
    typeof value.sourceFileDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.sourceFileDigest) &&
    "title" in value &&
    typeof value.title === "string"
  );
}

function isDeleteRequest(message: unknown): message is DeleteRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "delete" &&
    "records" in message &&
    Array.isArray(message.records) &&
    message.records.every(isDeleteRecord)
  );
}

function saveTiddler(
  tw: TiddlyWikiRuntime,
  tiddler: TiddlyWikiTiddler,
  fileInfo: TiddlerFileInfo,
): Promise<void> {
  return new Promise((resolve, reject) => {
    tw.utils.saveTiddlerToFile(tiddler, fileInfo, (error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        resolve();
      }
    });
  });
}

function deleteTiddlerFile(
  tw: TiddlyWikiRuntime,
  fileInfo: TiddlerFileInfo,
): Promise<void> {
  return new Promise((resolve, reject) => {
    tw.utils.deleteTiddlerFile(fileInfo, (error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        resolve();
      }
    });
  });
}

function send(message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    process.send!(message, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function recordSyncState(
  tw: TiddlyWikiRuntime,
  request: SyncRequest,
): Promise<void> {
  for (const record of request.records) {
    const { digest, sourceFileDigest: expectedFileDigest, title, uri } = record;
    try {
      const tiddler = tw.wiki.getTiddler(title);
      if (!tiddler) {
        throw new Error("The source tiddler no longer exists.");
      }

      const fileInfo = tw.boot.files[title];
      if (!fileInfo) {
        throw new Error("The source tiddler is not backed by a writable file.");
      }
      if (
        !fileInfo.hasMetaFile &&
        fileInfo.type !== "application/x-tiddler"
      ) {
        throw new Error(
          `Refusing to rewrite unsupported source file type ${fileInfo.type}.`,
        );
      }

      const tags = Array.isArray(tiddler.fields.tags)
        ? tiddler.fields.tags
        : [];
      if (
        tags.includes(request.tag) &&
        tiddler.fields[NMEM_URI_FIELD] === uri &&
        tiddler.fields[NMEM_DIGEST_FIELD] === digest
      ) {
        await send({ status: "already-current", title, type: "result" });
        continue;
      }
      if ((await sourceFileDigest(fileInfo)) !== expectedFileDigest) {
        throw new Error(
          "The source file changed after apply scanning. Run plan again before retrying.",
        );
      }

      const updated = new tw.Tiddler(tiddler, {
        [NMEM_DIGEST_FIELD]: digest,
        [NMEM_URI_FIELD]: uri,
        tags: tags.includes(request.tag) ? tags : [...tags, request.tag],
      });
      await saveTiddler(tw, updated, fileInfo);
      await send({ status: "written", title, type: "result" });
    } catch (error) {
      await send({
        error: error instanceof Error ? error.message : String(error),
        status: "failed",
        title,
        type: "result",
      });
    }
  }

  await send({ type: "done" });
  process.disconnect();
}

async function deleteSourceTiddlers(
  tw: TiddlyWikiRuntime,
  request: DeleteRequest,
): Promise<void> {
  for (const record of request.records) {
    const { sourceFileDigest: expectedFileDigest, title } = record;
    try {
      const tiddler = tw.wiki.getTiddler(title);
      if (!tiddler) {
        throw new Error("The source tiddler no longer exists.");
      }

      const fileInfo = tw.boot.files[title];
      if (!fileInfo) {
        throw new Error("The source tiddler is not backed by a deletable file.");
      }
      if (
        !fileInfo.hasMetaFile &&
        fileInfo.type !== "application/x-tiddler"
      ) {
        throw new Error(
          `Refusing to delete shared source file type ${fileInfo.type}.`,
        );
      }
      if ((await sourceFileDigest(fileInfo)) !== expectedFileDigest) {
        throw new Error(
          "The source file changed after apply scanning. Run plan again before retrying.",
        );
      }

      await deleteTiddlerFile(tw, fileInfo);
      await send({ status: "deleted", title, type: "result" });
    } catch (error) {
      await send({
        error: error instanceof Error ? error.message : String(error),
        status: "failed",
        title,
        type: "result",
      });
    }
  }

  await send({ type: "done" });
  process.disconnect();
}

const tw = TiddlyWiki();
tw.boot.argv = [wikiPath, "--output", tmpdir()];
tw.boot.boot(() => {
  process.once("message", (message) => {
    if (isSyncRequest(message)) {
      void recordSyncState(tw, message).catch((error) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      });
      return;
    }
    if (isDeleteRequest(message)) {
      void deleteSourceTiddlers(tw, message).catch((error) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      });
      return;
    }

    process.stderr.write("The TiddlyWiki source mutation request is invalid.\n");
    process.exit(1);
  });
  void send({ type: "ready" }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
});
