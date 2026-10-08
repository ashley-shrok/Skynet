import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  getUserServiceSecrets: vi.fn(),
  setUserServiceSecret: vi.fn(),
  clearUserServiceSecret: vi.fn(),
}));
vi.mock("@/api/service-secrets-api", () => api);

import { AdminServiceSecrets } from "./AdminServiceSecrets";

const zoho = {
  service: "zoho",
  serviceDescription: "Zoho CRM",
  name: "ZOHO_TOKEN",
  label: "Zoho API token",
  managedBy: "admin" as const,
  hasFallback: false,
  isSet: true,
  updatedAt: "2026-10-08T00:00:00Z",
};

describe("AdminServiceSecrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.setUserServiceSecret.mockResolvedValue(undefined);
    api.clearUserServiceSecret.mockResolvedValue(undefined);
  });

  it("renders nothing when no service declares per-user secrets", async () => {
    api.getUserServiceSecrets.mockResolvedValue([]);
    const { container } = render(<AdminServiceSecrets userId="u1" />);
    await waitFor(() =>
      expect(api.getUserServiceSecrets).toHaveBeenCalledWith("u1"),
    );
    expect(container.textContent).toBe("");
  });

  it("shows admin-managed keys with status but never a value, and can replace one", async () => {
    api.getUserServiceSecrets.mockResolvedValue([zoho]);
    const user = userEvent.setup();
    render(<AdminServiceSecrets userId="u1" />);
    expect(await screen.findByText("Admin-managed")).toBeTruthy();
    expect(
      screen.getByTestId("service-secret-zoho-ZOHO_TOKEN-status").textContent,
    ).toMatch(/^Set/);
    const input = screen.getByTestId(
      "service-secret-zoho-ZOHO_TOKEN-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("");
    await user.type(input, "new-token");
    await user.click(screen.getByTestId("service-secret-zoho-ZOHO_TOKEN-save"));
    expect(api.setUserServiceSecret).toHaveBeenCalledWith(
      "u1",
      zoho,
      "new-token",
    );
    await waitFor(() =>
      expect(api.getUserServiceSecrets).toHaveBeenCalledTimes(2),
    );
  });

  it("removes after confirming", async () => {
    api.getUserServiceSecrets.mockResolvedValue([zoho]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<AdminServiceSecrets userId="u1" />);
    await user.click(
      await screen.findByTestId("service-secret-zoho-ZOHO_TOKEN-remove"),
    );
    expect(api.clearUserServiceSecret).toHaveBeenCalledWith("u1", zoho);
  });

  it("shows the server's error when saving fails", async () => {
    api.getUserServiceSecrets.mockResolvedValue([zoho]);
    api.setUserServiceSecret.mockRejectedValue({
      response: { data: { error: "value too long" } },
    });
    const user = userEvent.setup();
    render(<AdminServiceSecrets userId="u1" />);
    await user.type(
      await screen.findByTestId("service-secret-zoho-ZOHO_TOKEN-input"),
      "x",
    );
    await user.click(screen.getByTestId("service-secret-zoho-ZOHO_TOKEN-save"));
    expect(
      (await screen.findByTestId("service-secret-zoho-ZOHO_TOKEN-error"))
        .textContent,
    ).toBe("value too long");
  });
});
