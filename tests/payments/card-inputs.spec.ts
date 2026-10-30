import { describe, expect, it } from "vitest";
import { cardInputAttributes } from "./_card-inputs";

describe("checkout card-control assertion", () => {
  it("ignores random cc- fragments inside hidden registration IDs", () => {
    expect(cardInputAttributes('<input type="hidden" name="registrationId" value="c6655611-5598-4d2c-90cc-7b5869c156d3"/>')).toEqual([]);
  });
  it.each([
    '<input name="cardNumber"/>', '<input autocomplete="cc-number"/>',
    '<input placeholder="Card number"/>', '<input id="credit-card"/>',
    "<input aria-label='Card details'/>", '<input type="hidden" name="cardNumber"/>',
  ])("still rejects actual card-related attributes: %s", (html) => {
    expect(cardInputAttributes(html)).not.toHaveLength(0);
  });
});
