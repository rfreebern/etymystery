#!/usr/bin/env node
/**
 * Local curation admin app. Run it, open the printed URL, and work down the
 * batch: word + proposed chain on the left, reference pages in iframes on the
 * right (see admin/sources.ts for which sites allow embedding, measured).
 *
 *   npm run admin                 # http://127.0.0.1:8765
 *   npm run admin -- --port 9000
 *
 * Node's own http server, no dependencies and no build step. It reads and
 * writes exactly the same files as `npm run curate` (CURATION.md), so the two
 * can be interleaved freely. It binds to 127.0.0.1 only, and it never fetches
 * the reference sites itself: the iframes are just the browser loading pages.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_PATHS, buildQueue, mergeBatch, pullNextBatch, saveEntry, skipWord, type AdminPaths } from "./store";
import { sourcesFor } from "./sources";

const STATIC: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/style.css": "style.css",
};

// Injected by createAdminServer(). Module-level so the request handler can stay
// a plain function; the app is single-instance by design (it edits files on
// disk), so one server per process is the intended usage.
let paths: AdminPaths = DEFAULT_PATHS;
let publicDir = path.join(import.meta.dirname, "public");
let activeLimit = 25;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(res: ServerResponse, fileName: string): void {
  const filePath = path.join(publicDir, fileName);
  if (!existsSync(filePath)) {
    res.writeHead(404).end("not found");
    return;
  }
  const type = fileName.endsWith(".js")
    ? "text/javascript; charset=utf-8"
    : fileName.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(readFileSync(filePath));
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = url.pathname;

  if (req.method === "GET" && STATIC[route]) return serveStatic(res, STATIC[route]!);

  if (req.method === "GET" && route === "/api/state") {
    const index = Number.parseInt(url.searchParams.get("index") ?? "0", 10) || 0;
    return sendJson(res, 200, buildQueue(paths, index));
  }

  if (req.method === "GET" && route === "/api/sources") {
    const word = url.searchParams.get("word") ?? "";
    if (!word) return sendJson(res, 400, { error: "word is required" });
    return sendJson(res, 200, sourcesFor(word));
  }

  if (req.method === "POST") {
    void (async (): Promise<void> => {
      try {
        const body = await readBody(req);
        if (route === "/api/entry") {
          const state = saveEntry(
            paths,
            {
              word: String(body.word ?? ""),
              year: Number(body.year),
              tier: Number(body.tier),
              blurb: String(body.blurb ?? ""),
              pos: String(body.pos ?? ""),
              origin: String(body.origin ?? ""),
            },
            Number(body.index ?? 0),
          );
          return sendJson(res, 200, state);
        }
        if (route === "/api/skip") {
          return sendJson(res, 200, skipWord(paths, String(body.word ?? ""), Number(body.index ?? 0)));
        }
        if (route === "/api/merge") {
          return sendJson(res, 200, mergeBatch(paths));
        }
        if (route === "/api/next") {
          const limit = Number(body.limit ?? activeLimit) || 25;
          return sendJson(res, 200, pullNextBatch(paths, limit));
        }
        return sendJson(res, 404, { error: `unknown route ${route}` });
      } catch (err) {
        return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return;
  }

  res.writeHead(404).end("not found");
}

/**
 * The app as an http.Server. Tests bind port 0 and read the assigned port;
 * `main()` below does the CLI wiring.
 */
export function createAdminServer(options: {
  paths?: AdminPaths;
  publicDir?: string;
  defaultLimit?: number;
} = {}): Server {
  paths = options.paths ?? paths;
  publicDir = options.publicDir ?? publicDir;
  activeLimit = options.defaultLimit ?? activeLimit;
  return createServer(handleRequest);
}

function main(): void {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "8765" },
      worklist: { type: "string" },
      curation: { type: "string" },
      batch: { type: "string" },
      skip: { type: "string" },
      bank: { type: "string" },
      limit: { type: "string", default: "25" },
      "no-pull": { type: "boolean", default: false },
    },
  });

  const configured: AdminPaths = {
    worklist: values.worklist ?? DEFAULT_PATHS.worklist,
    curation: values.curation ?? DEFAULT_PATHS.curation,
    batch: values.batch ?? DEFAULT_PATHS.batch,
    skip: values.skip ?? DEFAULT_PATHS.skip,
    bank: values.bank ?? DEFAULT_PATHS.bank,
  };
  const limit = Number.parseInt(values.limit!, 10) || 25;

  if (!values["no-pull"] && buildQueue(configured).queue.length === 0) {
    const state = pullNextBatch(configured, limit);
    console.log(`batch was empty: pulled ${state.queue.length} words into ${configured.batch}`);
  }

  const server = createAdminServer({ paths: configured, defaultLimit: limit });
  server.listen(Number.parseInt(values.port!, 10), "127.0.0.1", () => {
    const state = buildQueue(configured);
    console.log(`curation admin on http://127.0.0.1:${values.port}`);
    console.log(
      `batch: ${state.queue.length} words | curated: ${state.curatedCount} of ${state.worklistCount} candidates`,
    );
    console.log(`files: ${configured.batch} -> ${configured.curation}`);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
