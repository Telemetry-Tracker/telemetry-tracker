import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Controller,
  Get,
  Injectable,
  MiddlewareConsumer,
  Module,
  NotFoundException,
  type INestApplication,
  type NestMiddleware,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { shutdown as coreShutdown } from "@telemetry-tracker/core";
import { captureNestException, init, middleware, TelemetryInterceptor } from "./index.js";

// Real Nest 11 + Express app. Decorators are applied by hand so the test needs no
// experimentalDecorators/emitDecoratorMetadata transform.
function decorate(cls: { prototype: object }, method: string, path: string): void {
  const d = Object.getOwnPropertyDescriptor(cls.prototype, method)!;
  Get(path)(cls.prototype, method, d);
}

class QaController {
  ok() {
    return { ok: true };
  }
  boom() {
    throw new Error("nest-sync-boom");
  }
  async boomAsync() {
    await new Promise((r) => setTimeout(r, 5));
    throw new Error("nest-async-boom");
  }
  missing() {
    throw new NotFoundException("nope");
  }
}
decorate(QaController, "ok", "ok");
decorate(QaController, "boom", "boom");
decorate(QaController, "boomAsync", "boom-async");
decorate(QaController, "missing", "missing");
Controller("qa")(QaController);

const trackRequest = middleware();
class TelemetryMiddleware implements NestMiddleware {
  use(req: unknown, res: unknown, next: () => void) {
    trackRequest(req as never, res, next);
  }
}
Injectable()(TelemetryMiddleware);

class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TelemetryMiddleware).forRoutes("*");
  }
}
Module({ controllers: [QaController] })(AppModule);

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
let app: INestApplication;
let base: string;

const bodies = (path: string) =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).endsWith(path))
    .map(([, o]) => JSON.parse((o as { body: string }).body));

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalInterceptors(new TelemetryInterceptor());
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "" });
  globalThis.fetch = fetchMock as never;
  init({ ingestUrl: "http://ingest.test", app: "nest-test", apiKey: "k", batchInterval: 0, webVitals: false });
});
afterEach(() => {
  coreShutdown();
  globalThis.fetch = realFetch;
});

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const r = await realFetch(base + path);
  return { status: r.status, body: await r.json() };
}

describe("TelemetryInterceptor (#920)", () => {
  it("reports a sync controller exception and keeps Nest's 500 response", async () => {
    const r = await get("/qa/boom?token=secret");
    expect(r).toEqual({ status: 500, body: { statusCode: 500, message: "Internal server error" } });
    await vi.waitFor(() => expect(bodies("/ingest/error")).toHaveLength(1));
    const [e] = bodies("/ingest/error");
    expect(e.message).toBe("nest-sync-boom");
    expect(e.context).toMatchObject({
      source: "nestjs",
      nest_context: "http",
      method: "GET",
      path: "/qa/boom",
      handler: "QaController.boom",
    });
  });

  it("reports an async controller exception", async () => {
    const r = await get("/qa/boom-async");
    expect(r.status).toBe(500);
    await vi.waitFor(() => expect(bodies("/ingest/error")).toHaveLength(1));
    expect(bodies("/ingest/error")[0].message).toBe("nest-async-boom");
  });

  it("does not report 4xx HttpExceptions and keeps their response", async () => {
    const r = await get("/qa/missing");
    expect(r).toEqual({ status: 404, body: { statusCode: 404, message: "nope", error: "Not Found" } });
    await new Promise((res) => setTimeout(res, 50));
    expect(bodies("/ingest/error")).toHaveLength(0);
  });

  it("passes successful responses through", async () => {
    expect(await get("/qa/ok")).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("Nest middleware URL (#921)", () => {
  it("records the full request URL, not '/'", async () => {
    await get("/qa/ok?x=1");
    await vi.waitFor(() => {
      const urls = bodies("/ingest/event")
        .flatMap((b) => (b.events ? b.events : [b]))
        .filter((e: { name: string }) => e.name === "$request")
        .map((e: { properties: { url: string } }) => e.properties.url);
      expect(urls).toContain("/qa/ok?x=1");
    });
  });

  it("falls back to req.url without originalUrl (plain node http)", () => {
    const next = vi.fn();
    middleware()({ method: "GET", url: "/plain?y=2" }, {}, next);
    const ev = bodies("/ingest/event").flatMap((b) => (b.events ? b.events : [b]));
    expect(ev.find((e: { name: string }) => e.name === "$request")?.properties.url).toBe("/plain?y=2");
  });
});

// Compile-time check (pnpm --filter @telemetry-tracker/node typecheck): the SDK types must fit
// Nest's own interfaces, otherwise `app.useGlobalInterceptors(new TelemetryInterceptor())` fails
// to compile in user apps.
import type { ArgumentsHost, NestInterceptor } from "@nestjs/common";
export const _typecheckInterceptor: NestInterceptor = new TelemetryInterceptor();
export const _typecheckFilter = (e: unknown, host: ArgumentsHost) => captureNestException(e, host);

describe("captureNestException", () => {
  it("never throws and honours shouldReport", () => {
    expect(() => captureNestException(new Error("x"), { getType: () => { throw new Error("bad host"); } })).not.toThrow();
    captureNestException(new Error("skip"), undefined, { shouldReport: () => false });
    expect(bodies("/ingest/error").map((b) => b.message)).toEqual(["x"]);
  });
});
