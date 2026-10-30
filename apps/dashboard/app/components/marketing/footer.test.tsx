import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "./footer";

vi.mock("./MarketingSubscribeForm", () => ({ MarketingSubscribeForm: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("renders the injected platform version rather than a hardcoded release", () => {
  vi.stubEnv("TT_PLATFORM_VERSION", "1.18.5");
  render(<Footer />);
  expect(screen.getByText(/^v1\.18\.5 ·/)).toBeTruthy();
  expect(screen.queryByText(/v1\.2\.0/)).toBeNull();
});

it("does not advertise a stale version if build metadata is unavailable", () => {
  vi.stubEnv("TT_PLATFORM_VERSION", "");
  render(<Footer />);
  expect(screen.queryByText(/^v\d/)).toBeNull();
});

it("offers a persistent Cookie settings control to change or withdraw consent", () => {
  render(<Footer />);
  expect(screen.getByRole("button", { name: "Cookie settings" })).toBeTruthy();
});
