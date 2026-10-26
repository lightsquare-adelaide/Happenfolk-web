import { describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  invertTheme,
  isTheme,
  normaliseStored,
  readAppliedTheme,
  readStoredTheme,
  resolveTheme,
  themeBootstrapScript,
} from "./theme";

describe("resolveTheme", () => {
  it("prefers an explicit stored light choice on a dark system", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("prefers an explicit stored dark choice on a light system", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("ignores a stored value that is not one of ours", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
    expect(resolveTheme("DARK", false)).toBe("light");
    expect(resolveTheme(undefined, true)).toBe("dark");
  });
});

describe("normaliseStored / isTheme", () => {
  it("accepts only the two supported values", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("auto")).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(normaliseStored("dark")).toBe("dark");
    expect(normaliseStored("nope")).toBeNull();
  });
});

describe("invertTheme", () => {
  it("flips both ways", () => {
    expect(invertTheme("light")).toBe("dark");
    expect(invertTheme("dark")).toBe("light");
  });
});

describe("browser guards", () => {
  // These run in a node environment (no DOM, no localStorage): reading must
  // return null and writing must be a no-op instead of throwing.
  it("reads as null without a document", () => {
    expect(readAppliedTheme()).toBeNull();
    expect(readStoredTheme()).toBeNull();
  });

  it("does not throw when applying a theme without a document", () => {
    expect(() => applyTheme("dark")).not.toThrow();
  });
});

describe("themeBootstrapScript", () => {
  it("resolves the stored choice, else the system preference", () => {
    expect(themeBootstrapScript).toContain(THEME_STORAGE_KEY);
    expect(themeBootstrapScript).toContain("prefers-color-scheme: dark");
    expect(themeBootstrapScript).toContain('setAttribute("data-theme"');
  });

  it("stays inline and self-hosted", () => {
    expect(themeBootstrapScript).not.toContain("http");
    expect(themeBootstrapScript).not.toContain("import(");
  });

  it("survives unavailable storage", () => {
    // The storage read is the only part that can throw, so it must be the only
    // part inside the try block; the fallback stays reachable.
    const tryBlock = themeBootstrapScript.slice(
      themeBootstrapScript.indexOf("try{"),
      themeBootstrapScript.indexOf("catch"),
    );
    expect(tryBlock).toContain("localStorage.getItem");
    expect(tryBlock).not.toContain("setAttribute");
  });
});
