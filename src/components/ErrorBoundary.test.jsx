import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary.jsx";

function Bomb() {
  throw new Error("boom from Bomb");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    const { container } = render(
      <ErrorBoundary>
        <div>safe child</div>
      </ErrorBoundary>
    );
    expect(container.textContent).toBe("safe child");
  });

  it("renders a fallback when a child throws", () => {
    // Suppress React's expected console.error from the boundary.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toMatch(/boom from Bomb/);
    spy.mockRestore();
  });
});
