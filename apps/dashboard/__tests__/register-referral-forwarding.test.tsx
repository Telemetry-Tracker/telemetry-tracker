/**
 * B3: Test that RegisterPageForm forwards rewardfulReferralId and viaToken
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { RegisterPageForm } from "@/app/components/auth/RegisterPageForm";
import { useRouter, useSearchParams } from "next/navigation";
import * as authActions from "@/app/auth/actions";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

// Mock next/image
vi.mock("next/image", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ src, alt, ...props }: any) => {
    // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
    return <img src={src as string} alt={alt as string} {...props} />;
  },
}));

// Mock auth actions
vi.mock("@/app/auth/actions", () => ({
  register: vi.fn(),
}));

describe("RegisterPageForm - Referral Forwarding", () => {
  let mockRouter: { push: Mock; refresh: Mock };
  let mockSearchParams: URLSearchParams;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter = {
      push: vi.fn(),
      refresh: vi.fn(),
    };
    mockSearchParams = new URLSearchParams();
    (useRouter as Mock).mockReturnValue(mockRouter);
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);
    (authActions.register as Mock).mockResolvedValue({ ok: true });
    
    // Ensure window is defined
    if (typeof window === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).window = {};
    }
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

  it("forwards rewardfulReferralId when window.Rewardful.referral is present", async () => {
    // Set up global Rewardful object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window.Rewardful = {
      referral: "00000000-0000-4000-8000-000000000001",
    };

    const { unmount } = render(<RegisterPageForm serverChoice={null} />);

    fillForm();

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authActions.register).toHaveBeenCalledTimes(1);
    });

    const formData = (authActions.register as Mock).mock.calls[0][0] as FormData;
    expect(formData.get("rewardfulReferralId")).toBe("00000000-0000-4000-8000-000000000001");
    
    unmount();
  });

  it("forwards viaToken from query string", async () => {
    mockSearchParams = new URLSearchParams("via=affiliate123");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    const { unmount } = render(<RegisterPageForm serverChoice={null} />);

    fillForm();

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authActions.register).toHaveBeenCalledTimes(1);
    });

    const formData = (authActions.register as Mock).mock.calls[0][0] as FormData;
    expect(formData.get("viaToken")).toBe("affiliate123");
    
    unmount();
  });

  it("forwards both fields when both are present", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window.Rewardful = {
      referral: "00000000-0000-4000-8000-000000000002",
    };
    mockSearchParams = new URLSearchParams("via=affiliate456");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    const { unmount } = render(<RegisterPageForm serverChoice={null} />);

    fillForm();

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authActions.register).toHaveBeenCalledTimes(1);
    });

    const formData = (authActions.register as Mock).mock.calls[0][0] as FormData;
    expect(formData.get("rewardfulReferralId")).toBe("00000000-0000-4000-8000-000000000002");
    expect(formData.get("viaToken")).toBe("affiliate456");
    
    unmount();
  });
});
