import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckInSecret, decryptCheckInSecret, checkInTokenHash, redactCheckInSecrets } from "./checkin-secrets.js";
import { safeSanitizeSentryEvent } from "./sentry-privacy.js";
import { CheckInRateLimiter, isCheckInPreviewBot } from "./checkin-rate-limit.js";
import { canManageCheckIns, evaluatorIsStale } from "./checkins.js";
import { checkInMonitorView } from "../routes/checkins.js";
import { PLAN_LIMITS } from "../config/plans.js";
afterEach(() => vi.unstubAllEnvs());
describe("check-in credentials, limits and privacy", () => {
  it("encrypts with authenticated encryption and uses a separate indexed digest", () => {
    vi.stubEnv("CHECKIN_ENCRYPTION_KEY", "ab".repeat(32));
    const data = createCheckInSecret();
    const token = decryptCheckInSecret(data.token_encrypted);
    expect(token).toMatch(/^ttc_[a-f0-9]{64}$/);
    expect(checkInTokenHash(token)).toBe(data.token_hash);
    expect(JSON.stringify(data)).not.toContain(token);
    const bytes = Buffer.from(data.token_encrypted, "base64"); bytes[30] ^= 1;
    expect(() => decryptCheckInSecret(bytes.toString("base64"))).toThrow();
    expect(createCheckInSecret().token_hash).not.toBe(data.token_hash);
  });
  it("requires a dedicated encryption key", () => {
    vi.stubEnv("CHECKIN_ENCRYPTION_KEY", ""); expect(() => createCheckInSecret()).toThrow("CHECKIN_ENCRYPTION_KEY");
  });
  it("never exposes encrypted or hashed credentials to viewers", () => {
    const row = { id: "monitor", token_hash: "secret", token_encrypted: "not decryptable" } as never;
    expect(checkInMonitorView(row, false)).toEqual({ id: "monitor" });
    expect(canManageCheckIns("VIEWER")).toBe(false);
    expect(canManageCheckIns(null)).toBe(false);
    expect(canManageCheckIns("EDITOR")).toBe(true);
    expect(canManageCheckIns("OWNER")).toBe(true);
  });
  it("redacts tokens and arbitrary checkin path secrets in log strings", () => {
    expect(redactCheckInSecrets("GET /checkin/old-secret/fail?rid=abc ttc_123abc")).toBe("GET /checkin/[redacted]/fail?rid=abc [redacted]");
  });
  it("redacts operator Sentry request URLs, exceptions, breadcrumbs and extras", () => {
    const event = { request: { method: "POST", url: "https://api.example/checkin/ttc_abc/start?rid=abc", data: "private" }, exception: { values: [{ value: "ttc_abc" }] }, breadcrumbs: [{ data: { url: "/checkin/arbitrary-token" } }], extra: { key: "ttc_abc" } };
    const result = JSON.stringify(safeSanitizeSentryEvent(event));
    expect(result).not.toContain("ttc_abc"); expect(result).not.toContain("arbitrary-token"); expect(result).not.toContain("private"); expect(result).not.toContain("rid=");
  });
  it("redacts exception secrets even when a hostile root stops the normal Sentry walk", () => {
    const target = { message: "ttc_abc", exception: { values: [{ value: "/checkin/ttc_abc/start" }] } };
    const event = new Proxy(target, { ownKeys() { throw new Error("cannot enumerate"); } });
    safeSanitizeSentryEvent(event);
    expect(JSON.stringify(target)).not.toContain("ttc_abc");
  });
  it("limits monitors separately from projects and expires windows", () => {
    const limiter = new CheckInRateLimiter();
    for (let i = 0; i < 12; i++) expect(limiter.consume("m1", "p", 0)).toBe(true);
    expect(limiter.consume("m1", "p", 0)).toBe(false);
    expect(limiter.consume("m2", "p", 0)).toBe(true);
    expect(limiter.consume("m1", "p", 60_000)).toBe(true);
  });
  it("enforces a project-wide cap even across distinct monitors", () => {
    const limiter = new CheckInRateLimiter();
    for (let i = 0; i < 600; i++) expect(limiter.consume(`m${i}`, "p", 0)).toBe(true);
    expect(limiter.consume("extra", "p", 0)).toBe(false);
    expect(limiter.consume("extra", "another", 0)).toBe(true);
  });
  it("detects preview agents but permits curl", () => {
    for (const agent of ["Slackbot-LinkExpanding", "Discordbot", "TelegramBot", "MicrosoftPreview", "WhatsApp", "Googlebot"]) expect(isCheckInPreviewBot(agent)).toBe(true);
    expect(isCheckInPreviewBot("curl/8.0")).toBe(false);
  });
  it("uses approved plan limits", () => expect(Object.values(PLAN_LIMITS).map(p => p.maxCheckInMonitorsPerProject)).toEqual([5, 50, 500]));
  it("treats absent or old evaluator heartbeats as stale", () => {
    const now = new Date();
    expect(evaluatorIsStale(null, now, 5)).toBe(true);
    expect(evaluatorIsStale(new Date(now.getTime() - 601_000), now, 5)).toBe(true);
    expect(evaluatorIsStale(new Date(now.getTime() - 600_000), now, 5)).toBe(false);
  });
});
