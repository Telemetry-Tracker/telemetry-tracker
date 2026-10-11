/**
 * RegisterPageForm forwards native referralCode + capturedAt from URL / storage.
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { RegisterPageForm } from "@/app/components/auth/RegisterPageForm";
import { useRouter, useSearchParams } from "next/navigation";
import * as authActions from "@/app/auth/actions";
import { AFFILIATE_REFERRAL_STORAGE_KEY } from "@/lib/affiliate-referral";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ src, alt, ...props }: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src as string} alt={alt as string} {...props} />;
  },
}));

vi.mock("@/app/auth/actions", () => ({
  register: vi.fn(),
}));

describe("RegisterPageForm - Referral Forwarding", () => {
  let mockRouter: { push: Mock; refresh: Mock };
  let mockSearchParams: URLSearchParams;

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockRouter = {
      push: vi.fn(),
      refresh: vi.fn(),
    };
    mockSearchParams = new URLSearchParams();
    (useRouter as Mock).mockReturnValue(mockRouter);
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);
    (authActions.register as Mock).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  function fillForm() {
    const nameInput = document.getElementById("register-name") as HTMLInputElement;
    const emailInput = document.getElementById("register-email") as HTMLInputElement;
    const passwordInput = document.getElementById("register-password") as HTMLInputElement;
    const confirmInput = document.getElementById("register-confirm") as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: "Test User" } });
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "Password123!" } });
    fireEvent.change(confirmInput, { target: { value: "Password123!" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /terms of service/i }));
  }

  it("forwards referralCode from ?ref=", async () => {
    mockSearchParams = new URLSearchParams("ref=alice");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    const { unmount } = render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authActions.register).toHaveBeenCalledTimes(1);
    });

    const formData = (authActions.register as Mock).mock.calls[0][0] as FormData;
    expect(formData.get("referralCode")).toBe("alice");
    expect(formData.get("referralCapturedAt")).toBeTruthy();
    unmount();
  });

  it("forwards referralCode from ?via= alias", async () => {
    mockSearchParams = new URLSearchParams("via=affiliate123");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    const { unmount } = render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authActions.register).toHaveBeenCalledTimes(1);
    });

    const formData = (authActions.register as Mock).mock.calls[0][0] as FormData;
    expect(formData.get("referralCode")).toBe("affiliate123");
    unmount();
  });

  it("uses last-touch session storage when the URL has no code", async () => {
    window.sessionStorage.setItem(
      AFFILIATE_REFERRAL_STORAGE_KEY,
      JSON.stringify({ code: "stored", capturedAt: "2026-09-01T00:00:00.000Z" })
    );

    const { unmount } = render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authActions.register).toHaveBeenCalledTimes(1);
    });

    const formData = (authActions.register as Mock).mock.calls[0][0] as FormData;
    expect(formData.get("referralCode")).toBe("stored");
    expect(formData.get("referralCapturedAt")).toBe("2026-09-01T00:00:00.000Z");
    unmount();
  });
});
