import { describe, expect, it, vi, afterEach } from "vitest";
import { flushFatalError, resetFatalFlushStateForTests } from "./fatal.js";

describe("flushFatalError", () => {
  afterEach(() => {
    resetFatalFlushStateForTests();
  });
  it("exits only after the error ingest settles", async () => {
    const order: string[] = [];
    let releaseIngest: () => void = () => {};
    const ingest = () =>
      new Promise<void>((resolve) => {
        releaseIngest = () => {
          order.push("ingest");
          resolve();
        };
      });

    flushFatalError(new Error("boom"), "uncaughtException", {
      ingest,
      exit: () => {
        order.push("exit");
      },
      timeoutMs: 500,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);
    releaseIngest();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["ingest", "exit"]);
  });

  it("exits after the timeout when ingest never settles", async () => {
    let exited = false;
    flushFatalError(new Error("boom"), "uncaughtException", {
      ingest: () => new Promise(() => {}),
      exit: () => {
        exited = true;
      },
      timeoutMs: 20,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exited).toBe(true);
  });

  it.each([
    [null, "null"],
    [undefined, "undefined"],
    ["string-throw", "string-throw"],
    [42, "42"],
    [{ a: 1 }, '{"a":1}'],
  ])("normalizes %j into a reportable Error before ingest", async (thrown, message) => {
    const ingest = vi.fn(async () => {});
    const exit = vi.fn();
    flushFatalError(thrown, "uncaughtException", {
      ingest,
      exit,
      timeoutMs: 50,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ message }),
      expect.objectContaining({ source: "uncaughtException" })
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("clears the flush timeout after ingest settles", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    let releaseIngest!: () => void;
    flushFatalError(new Error("boom"), "uncaughtException", {
      ingest: () =>
        new Promise<void>((resolve) => {
          releaseIngest = resolve;
        }),
      exit: () => {},
      timeoutMs: 5000,
    });
    releaseIngest();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("ignores a second fatal flush while one is in progress (strict rejections)", async () => {
    const ingest = vi.fn(async () => {});
    const exit = vi.fn();
    flushFatalError(new Error("a"), "unhandledRejection", {
      ingest,
      exit,
      timeoutMs: 50,
    });
    flushFatalError(new Error("a"), "uncaughtException", {
      ingest,
      exit,
      timeoutMs: 50,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
