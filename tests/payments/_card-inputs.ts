/** Check control semantics, excluding arbitrary bound form-state values. */
export function cardInputAttributes(html: string): string[] {
  return (html.match(/<input\b[^>]*>/gi) ?? []).flatMap((tag) =>
    [...tag.matchAll(/\b(?:name|id|type|autocomplete|placeholder|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
      .map((match) => match[1] ?? match[2])
      .filter((value) => /card|cc-/i.test(value)),
  );
}
