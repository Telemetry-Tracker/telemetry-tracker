/**
 * RegisterPageForm redirects to billing with plan intent after registration.
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { RegisterPageForm } from "@/app/components/auth/RegisterPageForm";
import { useRouter, useSearchParams } from "next/navigation";
import * as authActions from "@/app/auth/actions";
import { COOKIE_CONSENT_STORAGE_KEY } from "@/lib/cookie-consent";

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

describe("RegisterPageForm - Plan Intent Redirect", () => {
  let mockRouter: { push: Mock; refresh: Mock };
  let mockSearchParams: URLSearchParams;

  beforeEach(() => {
    vi.clearAllMocks();
    window.gtag = vi.fn();
    window.sessionStorage.clear();
    localStorage.clear();
    document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=; Path=/; Max-Age=0`;
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
    delete window.gtag;
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

  it("redirects to organization with plan=pro after successful registration", async () => {
    mockSearchParams = new URLSearchParams("plan=pro");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/settings/organization?plan=pro");
    });
  });

  it("redirects to organization with plan=business after successful registration", async () => {
    mockSearchParams = new URLSearchParams("plan=business");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/settings/organization?plan=business");
    });
  });

  it("redirects to organization settings when no plan", async () => {
    mockSearchParams = new URLSearchParams();
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/settings/organization");
    });
  });

  it("ignores invalid plan and redirects to organization settings", async () => {
    mockSearchParams = new URLSearchParams("plan=free");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/settings/organization");
    });
  });

  it("invite path wins: redirects to overview even with plan=pro", async () => {
    mockSearchParams = new URLSearchParams("invite=token123&plan=pro");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/overview");
    });
  });

  it("does not redirect on registration failure", async () => {
    mockSearchParams = new URLSearchParams("plan=pro");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);
    (authActions.register as Mock).mockResolvedValue({ ok: false, error: "Registration failed" });

    render(<RegisterPageForm serverChoice={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Registration failed");
    });
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
