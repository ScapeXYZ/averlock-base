import { describe, expect, it } from "vitest";
import { applyTheme, oppositeTheme, resolveTheme } from "./theme";

describe("theme", () => {
  it("defaults to the system theme", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("prefers a persisted valid selection", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("invalid", false)).toBe("light");
  });

  it("toggles between themes", () => {
    expect(oppositeTheme("light")).toBe("dark");
    expect(oppositeTheme("dark")).toBe("light");
  });

  it("applies the theme attribute and native color scheme", () => {
    const root = { dataset: {} as DOMStringMap, style: { colorScheme: "" } as CSSStyleDeclaration };
    applyTheme(root, "light");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });
});
