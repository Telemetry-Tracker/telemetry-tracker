/**
 * CreateOrganizationForm redirects to billing with plan intent after org creation.
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { CreateOrganizationForm } from "@/app/dashboard/settings/organization/CreateOrganizationForm";
import { useRouter } from "next/navigation";
import * as dashboardActions from "@/app/dashboard/actions";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/dashboard/actions", () => ({
  createOrganizationAction: vi.fn(),
}));

describe("CreateOrganizationForm - Plan Intent Redirect", () => {
  let mockRouter: { push: Mock; refresh: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter = {
      push: vi.fn(),
      refresh: vi.fn(),
    };
    (useRouter as Mock).mockReturnValue(mockRouter);
    (dashboardActions.createOrganizationAction as Mock).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  function fillForm() {
    const nameInput = document.getElementById("org-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Test Org" } });
  }

  it("redirects to billing with plan=pro after successful org creation", async () => {
    render(<CreateOrganizationForm planIntent="pro" />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/settings/billing?plan=pro");
      expect(mockRouter.refresh).not.toHaveBeenCalled();
    });
  });

  it("redirects to billing with plan=business after successful org creation", async () => {
    render(<CreateOrganizationForm planIntent="business" />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/settings/billing?plan=business");
      expect(mockRouter.refresh).not.toHaveBeenCalled();
    });
  });

  it("only refreshes when no plan intent", async () => {
    render(<CreateOrganizationForm planIntent={null} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => {
      expect(mockRouter.refresh).toHaveBeenCalled();
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  it("only refreshes when plan intent is undefined", async () => {
    render(<CreateOrganizationForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => {
      expect(mockRouter.refresh).toHaveBeenCalled();
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  it("does not redirect on org creation failure", async () => {
    (dashboardActions.createOrganizationAction as Mock).mockResolvedValue({
      ok: false,
      error: "Organization creation failed",
    });

    render(<CreateOrganizationForm planIntent="pro" />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Organization creation failed");
    });
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.refresh).not.toHaveBeenCalled();
  });
});
