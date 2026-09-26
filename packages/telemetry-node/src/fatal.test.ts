import { describe, expect, it } from "vitest";
import { flushFatalError } from "./fatal.js";

describe("flushFatalError", () => {
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
});
