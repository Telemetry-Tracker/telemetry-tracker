import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitMock = vi.fn();
vi.mock("@/app/affiliates/actions", () => ({
  submitAffiliateApplication: (input: unknown) => submitMock(input),
}));

import { AffiliateApplicationForm, validateAffiliateApplication } from "./AffiliateApplicationForm";

function fillValid() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
  fireEvent.change(screen.getByLabelText("Website or profile URL"), { target: { value: "ada.dev" } });
  fireEvent.change(screen.getByLabelText("How and where will you promote Telemetry Tracker?"), {
    target: { value: "Weekly newsletter for 4k Next.js developers plus YouTube tutorials." },
  });
}

describe("AffiliateApplicationForm", () => {
  beforeEach(() => submitMock.mockReset());
  afterEach(cleanup);

  it("renders labelled fields, a required terms checkbox and an off-screen honeypot", () => {
    render(<AffiliateApplicationForm />);
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
    const terms = screen.getByLabelText(/I have read and accept the/);
    expect((terms as HTMLInputElement).type).toBe("checkbox");
    expect(screen.getByRole("link", { name: "affiliate terms" }).getAttribute("href")).toBe("/affiliates/terms");
    const honeypot = document.querySelector('input[name="company_website"]') as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("blocks submit and shows field errors without calling the server", async () => {
    render(<AffiliateApplicationForm />);
    fireEvent.click(screen.getByRole("button", { name: "Apply to the program" }));
    expect(await screen.findByText("Accept the affiliate terms to apply")).toBeTruthy();
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("submits trimmed values and shows the success state", async () => {
    submitMock.mockResolvedValue({ ok: true, message: "Thanks — we review applications by hand." });
    render(<AffiliateApplicationForm />);
    fillValid();
    fireEvent.click(screen.getByLabelText(/I have read and accept the/));
    fireEvent.click(screen.getByRole("button", { name: "Apply to the program" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Application received"));
    expect(screen.getByRole("status").textContent).toContain("Thanks — we review applications by hand.");
    expect(submitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ada Lovelace",
        email: "ada@example.com",
        websiteUrl: "ada.dev",
        acceptTerms: true,
        company_website: "",
      })
    );
  });

  it("surfaces server field errors", async () => {
    submitMock.mockResolvedValue({ ok: false, error: "Please fix the highlighted fields.", fields: { email: "Use a real email" } });
    render(<AffiliateApplicationForm />);
    fillValid();
    fireEvent.click(screen.getByLabelText(/I have read and accept the/));
    fireEvent.click(screen.getByRole("button", { name: "Apply to the program" }));
    expect(await screen.findByText("Use a real email")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Please fix the highlighted fields.");
  });

  it("validates limits like the API", () => {
    const base = {
      name: "Ada",
      email: "ada@example.com",
      websiteUrl: "https://ada.dev",
      promotionPlan: "x".repeat(20),
      acceptTerms: true,
      company_website: "",
    };
    expect(validateAffiliateApplication(base)).toEqual({});
    expect(validateAffiliateApplication({ ...base, promotionPlan: "x".repeat(1001) }).promotionPlan).toBeTruthy();
    expect(validateAffiliateApplication({ ...base, websiteUrl: "not a url" }).websiteUrl).toBeTruthy();
    expect(validateAffiliateApplication({ ...base, email: "nope" }).email).toBeTruthy();
  });
});
