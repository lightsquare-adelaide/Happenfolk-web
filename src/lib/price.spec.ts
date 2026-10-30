import { describe, expect, it } from "vitest";
import { formatEventPrice } from "./price";

describe("formatEventPrice", () => {
  it("labels missing, zero and negative prices as Free", () => {
    expect(formatEventPrice(null)).toBe("Free");
    expect(formatEventPrice(undefined)).toBe("Free");
    expect(formatEventPrice(0)).toBe("Free");
    expect(formatEventPrice(-500)).toBe("Free");
    expect(formatEventPrice(Number.NaN)).toBe("Free");
  });

  it("shows whole-dollar prices without cents", () => {
    expect(formatEventPrice(2500)).toBe("A$25");
    expect(formatEventPrice(100)).toBe("A$1");
  });

  it("keeps two decimals for part-dollar prices", () => {
    expect(formatEventPrice(1250)).toBe("A$12.50");
    expect(formatEventPrice(1)).toBe("A$0.01");
  });
});
