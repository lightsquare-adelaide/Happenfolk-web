import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  TAG_MAX,
  TAGS_MAX,
  TITLE_MAX,
  YEAR_MAX,
  YEAR_MIN,
  compareItemOrder,
  isJsonObject,
  normalizeTags,
  parseItemCreate,
  parseItemPatch,
  parseMoveRequest,
  sortOwnerItems,
  titleProblem,
  yearProblem,
} from "./portfolio-management";

describe("isJsonObject", () => {
  it("accepts only plain objects", () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject("text")).toBe(false);
    expect(isJsonObject(7)).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });
});

describe("normalizeTags (mirror of trg_portfolio_items_normalize_tags)", () => {
  it("lowercases, trims, dedupes and keeps first-occurrence order", () => {
    expect(normalizeTags(["  Oil  ", "oil", "Palette"])).toEqual(["oil", "palette"]);
  });

  it("drops empty entries, over-long tags and non-strings", () => {
    expect(normalizeTags(["", "   ", "x".repeat(TAG_MAX + 1), 42, null, "ok".repeat(1)]))
      .toEqual(["ok"]);
    expect(normalizeTags(["y".repeat(TAG_MAX)])).toHaveLength(1);
  });

  it("caps the count", () => {
    const many = Array.from({ length: TAGS_MAX + 5 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(TAGS_MAX);
    expect(normalizeTags(many)).toEqual(many.slice(0, TAGS_MAX));
  });
});

describe("yearProblem", () => {
  it("clears on null/undefined", () => {
    expect(yearProblem(null)).toBeNull();
    expect(yearProblem(undefined)).toBeNull();
  });

  it("accepts integers inside the bounds, inclusive", () => {
    expect(yearProblem(YEAR_MIN)).toBeNull();
    expect(yearProblem(YEAR_MAX)).toBeNull();
    expect(yearProblem("1999")).toBeNull();
  });

  it("rejects out-of-range, floats, NaN, booleans and arrays", () => {
    for (const bad of [YEAR_MIN - 1, YEAR_MAX + 1, 1999.5, NaN, Infinity, true, [1999], "abc", ""]) {
      expect(yearProblem(bad), String(bad)).toMatch(/Year must be/);
    }
  });
});

describe("titleProblem", () => {
  it("requires a non-blank string within the bound", () => {
    expect(titleProblem("  Study  ")).toBeNull();
    expect(titleProblem("")).toMatch(/required/i);
    expect(titleProblem("   ")).toMatch(/required/i);
    expect(titleProblem(null)).toMatch(/required/i);
    expect(titleProblem(12)).toMatch(/required/i);
    expect(titleProblem("t".repeat(TITLE_MAX))).toBeNull();
    expect(titleProblem("t".repeat(TITLE_MAX + 1))).toMatch(/at most/);
  });
});

describe("parseItemCreate", () => {
  it("rejects null, array and scalar JSON bodies", () => {
    for (const body of [null, [], "title", 3, true]) {
      const parsed = parseItemCreate(body);
      expect(parsed.ok, JSON.stringify(body)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toMatch(/JSON object/);
    }
  });

  it("rejects unsupported keys instead of silently dropping them", () => {
    const parsed = parseItemCreate({
      title: "x",
      profile_id: "3f2b8c1e-9d4a-4f6b-8c2e-1a0b9d8e7f60",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toMatch(/Unsupported field: profile_id/);
    expect(parseItemCreate({ title: "x", published: true }).ok).toBe(false);
    expect(parseItemCreate({ title: "x", position: 0 }).ok).toBe(false);
  });

  it("rejects tags arrays containing non-string entries", () => {
    for (const tags of [[{}], [1], ["ok", null], ["ok", ["nested"]]]) {
      const parsed = parseItemCreate({ title: "x", tags });
      expect(parsed.ok, JSON.stringify(tags)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toMatch(/array of strings/);
    }
  });

  it("parses a full valid body", () => {
    const parsed = parseItemCreate({
      title: "  Harbour Study ",
      description: "Oil on board",
      year: "2001",
      tags: ["  SEA ", "sea", "harbour"],
    });
    expect(parsed).toEqual({
      ok: true,
      value: { title: "Harbour Study", description: "Oil on board", year: 2001, tags: ["sea", "harbour"] },
    });
  });

  it("defaults optional fields", () => {
    const parsed = parseItemCreate({ title: "Minimal" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({ title: "Minimal", description: null, year: null, tags: [] });
    }
  });

  it("rejects invalid fields without coercion", () => {
    expect(parseItemCreate({ title: "x", year: 1700 }).ok).toBe(false);
    expect(parseItemCreate({ title: "x", tags: "sea" }).ok).toBe(false);
    expect(parseItemCreate({ title: "x", description: 5 }).ok).toBe(false);
    expect(parseItemCreate({ title: "x", description: "d".repeat(DESCRIPTION_MAX + 1) }).ok).toBe(false);
    expect(parseItemCreate({}).ok).toBe(false);
  });
});

describe("parseItemPatch", () => {
  it("rejects unsupported keys even alongside valid ones", () => {
    const smuggled = parseItemPatch({ title: "x", published: true });
    expect(smuggled.ok).toBe(false);
    if (!smuggled.ok) expect(smuggled.problem).toMatch(/Unsupported field: published/);
    expect(parseItemPatch({ title: "x", profile_id: "whatever" }).ok).toBe(false);
    expect(parseItemPatch({ title: "x", position: 3 }).ok).toBe(false);
    expect(parseItemPatch({ nope: 1 }).ok).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(parseItemPatch({}).ok).toBe(false);
  });

  it("rejects tags arrays containing non-string entries", () => {
    for (const tags of [[{}], [1], ["ok", undefined]]) {
      const parsed = parseItemPatch({ tags });
      expect(parsed.ok, JSON.stringify(tags)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toMatch(/array of strings/);
    }
  });

  it("keeps recognized keys and normalizes values", () => {
    const parsed = parseItemPatch({ title: " Renamed ", tags: ["  Oil ", "oil"] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ title: "Renamed", tags: ["oil"] });
  });

  it("supports clearing description, year and tags", () => {
    const parsed = parseItemPatch({ description: null, year: null, tags: null });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({ description: null, year: null, tags: [] });
    }
  });

  it("rejects malformed values", () => {
    expect(parseItemPatch(null).ok).toBe(false);
    expect(parseItemPatch([]).ok).toBe(false);
    expect(parseItemPatch({ title: "  " }).ok).toBe(false);
    expect(parseItemPatch({ year: 2101 }).ok).toBe(false);
    expect(parseItemPatch({ tags: { a: 1 } }).ok).toBe(false);
  });
});

describe("parseMoveRequest", () => {
  const uuid = "3f2b8c1e-9d4a-4f6b-8c2e-1a0b9d8e7f60";

  it("accepts a valid uuid + direction", () => {
    expect(parseMoveRequest({ itemId: uuid, direction: "up" })).toEqual({
      ok: true,
      value: { itemId: uuid, direction: "up" },
    });
    expect(parseMoveRequest({ itemId: uuid, direction: "down" }).ok).toBe(true);
  });

  it("rejects everything else, including unknown fields", () => {
    for (const body of [
      null,
      [],
      { itemId: uuid },
      { direction: "up" },
      { itemId: "nope", direction: "up" },
      { itemId: uuid, direction: "sideways" },
      { itemId: uuid, direction: null },
      { itemId: uuid, direction: "up", profile_id: uuid },
      { itemId: uuid, direction: "up", position: 0 },
    ]) {
      expect(parseMoveRequest(body).ok, JSON.stringify(body)).toBe(false);
    }
    const unknown = parseMoveRequest({ itemId: uuid, direction: "up", extra: 1 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.problem).toMatch(/Unsupported field: extra/);
  });
});

describe("compareItemOrder / sortOwnerItems", () => {
  it("orders by position, then created_at, then id", () => {
    const rows = [
      { id: "b", position: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: "a", position: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: "c", position: 0, created_at: "2026-06-01T00:00:00Z" },
      { id: "d", position: 1, created_at: "2025-01-01T00:00:00Z" },
    ];
    expect(sortOwnerItems(rows).map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("is a deterministic total order (antisymmetric, no ties)", () => {
    const x = { id: "x", position: 0, created_at: "t" };
    const y = { id: "y", position: 0, created_at: "t" };
    expect(compareItemOrder(x, y)).toBe(-compareItemOrder(y, x));
    expect(compareItemOrder(x, x)).toBe(0);
  });
});
