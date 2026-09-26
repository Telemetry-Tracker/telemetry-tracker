import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isTransactionalEmailConfigured,
  resetTransactionalEmailConfigWarningForTests,
  sendTransactionalEmail,
} from "./email.js";

describe("isTransactionalEmailConfigured", () => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.TELEMETRY_EMAIL_FROM;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.TELEMETRY_EMAIL_FROM;
    else process.env.TELEMETRY_EMAIL_FROM = prevFrom;
  });

  it("returns false when either env var is missing", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.TELEMETRY_EMAIL_FROM;
    expect(isTransactionalEmailConfigured()).toBe(false);

    process.env.RESEND_API_KEY = "re_test";
    expect(isTransactionalEmailConfigured()).toBe(false);

    delete process.env.RESEND_API_KEY;
    process.env.TELEMETRY_EMAIL_FROM = "Telemetry <noreply@example.com>";
    expect(isTransactionalEmailConfigured()).toBe(false);
  });

  it("returns true when both env vars are set", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TELEMETRY_EMAIL_FROM = "Telemetry <noreply@example.com>";
    expect(isTransactionalEmailConfigured()).toBe(true);
  });
});

describe("sendTransactionalEmail", () => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.TELEMETRY_EMAIL_FROM;
  const prevNodeEnv = process.env.NODE_ENV;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetTransactionalEmailConfigWarningForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.TELEMETRY_EMAIL_FROM;
    else process.env.TELEMETRY_EMAIL_FROM = prevFrom;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  it("dev-logs and skips Resend when not configured in development", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.TELEMETRY_EMAIL_FROM;
    process.env.NODE_ENV = "development";
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result).toEqual({
      sent: false,
      devLogged: true,
      error: "email_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "[email:dev]",
      "user@example.com",
      "Test",
      "<p>Hello</p>"
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("email_not_configured")
    );
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("strips CR/LF from dev-logged email fields", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.TELEMETRY_EMAIL_FROM;
    process.env.NODE_ENV = "development";
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await sendTransactionalEmail({
      to: "user@example.com\r\n[INFO] forged",
      subject: "Sub\nject",
      html: "<p>Hello\r\nWorld</p>",
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[email:dev]",
      "user@example.com[INFO] forged",
      "Subject",
      "<p>HelloWorld</p>"
    );
    logSpy.mockRestore();
  });

  it("returns email_not_configured and warns once in production when Resend is missing", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.TELEMETRY_EMAIL_FROM;
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result).toEqual({ sent: false, error: "email_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0]));
    expect(payload.reason).toBe("email_not_configured");
    expect(payload.missing).toEqual(["RESEND_API_KEY", "TELEMETRY_EMAIL_FROM"]);
    expect(JSON.stringify(payload)).not.toMatch(/re_/);

    await sendTransactionalEmail({
      to: "other@example.com",
      subject: "Again",
      html: "<p>Hi</p>",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("posts to Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TELEMETRY_EMAIL_FROM = "Telemetry <noreply@example.com>";
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    const result = await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Reset password",
      html: "<p>Link</p>",
      replyTo: "support@example.com",
    });

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test",
        }),
      })
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      from: string;
      reply_to?: string;
      attachments?: unknown;
    };
    expect(body.from).toBe("Telemetry <noreply@example.com>");
    expect(body.reply_to).toBe("support@example.com");
    expect(body.attachments).toBeUndefined();
  });

  it("attaches brand logo CID when HTML references cid:tt-brand-logo", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TELEMETRY_EMAIL_FROM = "Telemetry <noreply@example.com>";
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    const result = await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Release",
      html: '<img src="cid:tt-brand-logo" alt="Telemetry Tracker" />',
    });

    expect(result).toEqual({ sent: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      attachments: Array<{ content_id: string; filename: string; content_type: string }>;
    };
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]?.content_id).toBe("tt-brand-logo");
    expect(body.attachments[0]?.filename).toBe("email-logo.png");
    expect(body.attachments[0]?.content_type).toBe("image/png");
  });

  it("returns Resend error details on failure", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TELEMETRY_EMAIL_FROM = "Telemetry <noreply@example.com>";
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: "Domain not verified" }),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result).toEqual({
      sent: false,
      status: 403,
      error: "Domain not verified",
    });
    warnSpy.mockRestore();
  });
});
