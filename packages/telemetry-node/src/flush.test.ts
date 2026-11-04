import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBeforeExitHandler, createExitHandler } from "./index.js";

const distEntry = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js")).href;

describe("createBeforeExitHandler", () => {
  it("flushes when events are queued", () => {
    const flush = vi.fn(async () => {});
    createBeforeExitHandler({ pending: () => 2, flush })();
    expect(flush).toHaveBeenCalledTimes(1);
  });
  it("does nothing when the queue is empty (no exit loop)", () => {
    const flush = vi.fn(async () => {});
    createBeforeExitHandler({ pending: () => 0, flush })();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("createExitHandler", () => {
  it("warns only when events would be dropped", () => {
    const warn = vi.fn();
    createExitHandler({ pending: () => 0, warn })();
    expect(warn).not.toHaveBeenCalled();
    createExitHandler({ pending: () => 3, warn })();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("3 pending event(s) or error(s)"));
  });
});

describe("short-lived process delivery (#843)", () => {
  let server: Server;
  let url = "";
  const received: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "tt-node-flush-"));

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/ingest/batch") {
          for (const e of JSON.parse(body).events) received.push(e.name);
        }
        if (req.url === "/ingest/error") {
          setTimeout(() => {
            received.push(JSON.parse(body).message);
            res.writeHead(200).end("{}");
          }, 150);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  function run(script: string, name: string): Promise<number | null> {
    const file = join(dir, `${name}.mjs`);
    writeFileSync(file, script.replaceAll("__ENTRY__", distEntry).replaceAll("__URL__", url).replaceAll("__NAME__", name));
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [file], { stdio: "ignore" });
      child.on("exit", resolve);
    });
  }

  const jobMjs = `import { init, trackEvent } from "__ENTRY__";
init({ app: "qa-hb", apiKey: "k", environment: "test", ingestUrl: "__URL__" });
trackEvent("__NAME__");
`;

  it("job.mjs with no sleep delivers 2/2 events via the beforeExit flush", async () => {
    expect(await run(jobMjs, "job_run_1")).toBe(0);
    expect(await run(jobMjs, "job_run_2")).toBe(0);
    expect(received.filter((n) => n.startsWith("job_run_")).sort()).toEqual(["job_run_1", "job_run_2"]);
  }, 20000);

  it("await flush() delivers before process.exit()", async () => {
    const script = `import { init, trackEvent, flush } from "__ENTRY__";
init({ app: "qa-hb", apiKey: "k", environment: "test", ingestUrl: "__URL__" });
trackEvent("__NAME__");
await flush();
process.exit(0);
`;
    expect(await run(script, "explicit_flush")).toBe(0);
    expect(received).toContain("explicit_flush");
  }, 20000);

  it("handled error + flush + process.exit(1) delivers 2/2 delayed errors (#851)", async () => {
    const script = `import { init, trackError, flush } from "__ENTRY__";
init({ app: "qa", apiKey: "k", environment: "test", ingestUrl: "__URL__" });
try { throw new Error("__NAME__"); } catch (error) {
  trackError(error);
  await flush();
  process.exit(1);
}`;
    for (const name of ["handled_1", "handled_2"]) {
      expect(await run(script, name)).toBe(1);
      expect(received).toContain(name);
    }
  }, 20000);

  it("long-running process keeps batching (nothing sent before the interval)", async () => {
    const script = `import { init, trackEvent } from "__ENTRY__";
init({ app: "qa-hb", apiKey: "k", environment: "test", ingestUrl: "__URL__", batchInterval: 1500 });
trackEvent("__NAME___a"); trackEvent("__NAME___b");
const keepAlive = setInterval(() => {}, 1000);
setTimeout(() => { clearInterval(keepAlive); }, 2500);
`;
    const before = received.length;
    const p = run(script, "batched");
    await new Promise((r) => setTimeout(r, 800));
    expect(received.length).toBe(before);
    expect(await p).toBe(0);
    expect(received.filter((n) => n.startsWith("batched_"))).toEqual(["batched_a", "batched_b"]);
  }, 20000);
});
