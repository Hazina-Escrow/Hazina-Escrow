// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { I18nProvider } from "./i18n";
import QueryModal from "./components/ui/QueryModal";
import type { DatasetMeta } from "./lib/api";

expect.extend(toHaveNoViolations);

vi.mock("./lib/api", () => ({
  api: {
    initiateQuery: vi.fn(),
    demoQuery: vi.fn(),
    verifyPayment: vi.fn(),
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("hazina-tour-completed", "true");
  Object.defineProperty(window, "scrollTo", {
    value: vi.fn(),
    writable: true,
  });
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network disabled in test"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Accessibility tests", () => {
  test("App should have no accessibility violations", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const { container } = render(
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <I18nProvider>
            <App />
          </I18nProvider>
        </QueryClientProvider>
      </HelmetProvider>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("QueryModal should have no accessibility violations and keep focus trapped", async () => {
    const dataset: DatasetMeta = {
      id: "ds-a11y-1",
      name: "Accessibility Dataset",
      description: "Screen-reader-safe test fixture",
      type: "whale-wallets",
      pricePerQuery: 1,
      sellerWallet: `G${"A".repeat(55)}`,
      queriesServed: 12,
      totalEarned: 4,
      createdAt: new Date().toISOString(),
    };

    const { container } = render(
      <I18nProvider initialLocale="en">
        <QueryModal dataset={dataset} onClose={vi.fn()} onSuccess={vi.fn()} />
      </I18nProvider>,
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    const proceedButton = screen.getByRole("button", { name: "Proceed to Payment" });

    await waitFor(() => {
      expect(document.activeElement).toBe(closeButton);
    });

    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(proceedButton);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
