import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ThemeToggle } from "../src/components/theme-toggle";

it("includes the visible theme label in the accessible name before hydration", () => {
  const html = renderToStaticMarkup(createElement(ThemeToggle));
  const name = html.match(/aria-label="([^"]+)"/)![1];
  const visible = html.match(/<span[^>]*>([^<]+)<\/span>/)![1];
  expect(name.toLowerCase()).toContain(visible.toLowerCase());
});
