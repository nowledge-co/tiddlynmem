import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import { NOWLEDGE_MEM_TAG, type TiddlerRecord } from "./core.ts";

const workerFile = import.meta.url.endsWith(".ts")
  ? "./tiddlywiki-worker.ts"
  : "./tiddlywiki-worker.js";
const workerPath = fileURLToPath(new URL(workerFile, import.meta.url));
const syncWorkerFile = import.meta.url.endsWith(".ts")
  ? "./tiddlywiki-sync-worker.ts"
  : "./tiddlywiki-sync-worker.js";
const syncWorkerPath = fileURLToPath(new URL(syncWorkerFile, import.meta.url));
const WIKI_WORKER_TIMEOUT_MS = 300_000;

export { NOWLEDGE_MEM_TAG } from "./core.ts";

export interface WikiLoadResult {
  diagnostics: string[];
  records: TiddlerRecord[];
}

export interface WikiLoadOptions {
  includeSensitive?: boolean;
  tag?: string;
  timeoutMs?: number;
}

interface WorkerMessage {
  record?: TiddlerRecord;
  type: "done" | "record";
}

export interface TiddlerSyncRecord {
  digest: string;
  sourceFileDigest: string;
  title: string;
  uri: string;
}

export interface TiddlerDeleteRecord {
  sourceFileDigest: string;
  title: string;
}

export interface TiddlerSyncResult {
  error?: string;
  status: "already-current" | "failed" | "written";
  title: string;
}

export interface TiddlerDeleteResult {
  error?: string;
  status: "deleted" | "failed";
  title: string;
}

export function tiddlyWikiWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  delete sanitized.NMEM_API_KEY;
  return sanitized;
}

interface SourceWorkerMessage {
  error?: string;
  status?: "already-current" | "deleted" | "failed" | "written";
  title?: string;
  type: "done" | "ready" | "result";
}

function isWorkerMessage(message: unknown): message is WorkerMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message.type === "done" || message.type === "record")
  );
}

function isSourceWorkerMessage(message: unknown): message is SourceWorkerMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message.type === "done" ||
      message.type === "ready" ||
      message.type === "result")
  );
}

export function loadWiki(
  wikiPath: string,
  options: WikiLoadOptions = {},
): Promise<WikiLoadResult> {
  return new Promise<WikiLoadResult>((resolve, reject) => {
    const child = fork(
      workerPath,
      [wikiPath, options.tag ?? "", String(options.includeSensitive ?? false)],
      {
        env: tiddlyWikiWorkerEnvironment(),
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    const records: TiddlerRecord[] = [];
    const diagnostics: string[] = [];
    let stderr = "";
    let completed = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };
    const succeed = (result: WikiLoadResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timeoutMs = options.timeoutMs ?? WIKI_WORKER_TIMEOUT_MS;
    timer = setTimeout(() => {
      fail(new Error(`TiddlyWiki worker timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.on("message", (message) => {
      if (!isWorkerMessage(message)) {
        return;
      }
      if (message.type === "record" && message.record) {
        records.push(message.record);
      } else if (message.type === "done") {
        completed = true;
      }
    });
    if (!child.stderr) {
      fail(new Error("The TiddlyWiki worker stderr pipe is unavailable."));
      return;
    }
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      diagnostics.push(
        ...stderr
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean),
      );
      if (code === 0 && completed) {
        succeed({ diagnostics, records });
      } else {
        fail(
          new Error(
            `TiddlyWiki worker exited before completion with code ${code}: ${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

async function runSourceWorker(
  wikiPath: string,
  request:
    | { records: TiddlerDeleteRecord[]; type: "delete" }
    | { records: TiddlerSyncRecord[]; tag: string; type: "sync" },
): Promise<SourceWorkerMessage[]> {
  if (request.records.length === 0) {
    return Promise.resolve([]);
  }

  return new Promise<SourceWorkerMessage[]>((resolve, reject) => {
    const child = fork(syncWorkerPath, [wikiPath], {
      env: tiddlyWikiWorkerEnvironment(),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const results: SourceWorkerMessage[] = [];
    let stderr = "";
    let completed = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };
    const succeed = (sourceResults: SourceWorkerMessage[]): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(sourceResults);
    };
    timer = setTimeout(() => {
      fail(
        new Error(
          `TiddlyWiki sync worker timed out after ${WIKI_WORKER_TIMEOUT_MS}ms.`,
        ),
      );
    }, WIKI_WORKER_TIMEOUT_MS);

    child.on("message", (message) => {
      if (!isSourceWorkerMessage(message)) {
        return;
      }
      if (message.type === "ready") {
        child.send(request);
      } else if (
        message.type === "result" &&
        typeof message.title === "string" &&
        (message.status === "already-current" ||
          message.status === "deleted" ||
          message.status === "failed" ||
          message.status === "written")
      ) {
        results.push({
          ...(typeof message.error === "string"
            ? { error: message.error }
            : {}),
          status: message.status,
          title: message.title,
          type: "result",
        });
      } else if (message.type === "done") {
        completed = true;
      }
    });
    if (!child.stderr) {
      fail(new Error("The TiddlyWiki sync worker stderr pipe is unavailable."));
      return;
    }
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (
        code === 0 &&
        completed &&
        results.length === request.records.length
      ) {
        succeed(results);
      } else {
        fail(
          new Error(
            `TiddlyWiki sync worker exited before completion with code ${code}: ${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

export async function recordWikiSync(
  wikiPath: string,
  records: TiddlerSyncRecord[],
  tag = NOWLEDGE_MEM_TAG,
): Promise<TiddlerSyncResult[]> {
  const results = await runSourceWorker(wikiPath, {
    records,
    tag,
    type: "sync",
  });
  return results.map((result) => {
    if (
      typeof result.title !== "string" ||
      (result.status !== "already-current" &&
        result.status !== "failed" &&
        result.status !== "written")
    ) {
      throw new Error("The TiddlyWiki sync worker returned an invalid result.");
    }
    return {
      ...(typeof result.error === "string" ? { error: result.error } : {}),
      status: result.status,
      title: result.title,
    };
  });
}

export async function deleteWikiTiddlers(
  wikiPath: string,
  records: TiddlerDeleteRecord[],
): Promise<TiddlerDeleteResult[]> {
  const results = await runSourceWorker(wikiPath, {
    records,
    type: "delete",
  });
  return results.map((result) => {
    if (
      typeof result.title !== "string" ||
      (result.status !== "deleted" && result.status !== "failed")
    ) {
      throw new Error("The TiddlyWiki delete worker returned an invalid result.");
    }
    return {
      ...(typeof result.error === "string" ? { error: result.error } : {}),
      status: result.status,
      title: result.title,
    };
  });
}
