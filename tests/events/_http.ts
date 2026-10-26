import { expect } from "vitest";
import { appBase } from "../media/_harness";

/**
 * Shared HTTP helpers for the events API integration suite. One copy of
 * the request shape and the leak check — the rules here must not drift
 * between spec files.
 */

export type ApiResult = {
  status: number;
  json: { error?: string; event?: Record<string, unknown>; ok?: boolean; collaborator?: Record<string, unknown> } | null;
};

export async function apiCall(
  method: string,
  url: string,
  opts: { cookie?: string; body?: unknown; raw?: string; origin?: string; secFetchSite?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { origin: opts.origin ?? appBase() };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] = "application/json";
  if (opts.secFetchSite) headers["sec-fetch-site"] = opts.secFetchSite;
  const response = await fetch(`${appBase()}${url}`, {
    method,
    redirect: "manual",
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

/**
 * Friendly-error assertion: the response must carry our message AND
 * must not leak database structure, codes or policy names. The leak
 * pattern mirrors what Postgres/PostgREST would say verbatim.
 */
const LEAK_RE = /violates|constraint|permission denied|row-level security|invalid input syntax|relation "|does not exist \(SQL|23505|42501|PGRST|function public\./i;

export function expectFriendly(
  result: ApiResult,
  status: number,
  ...substrings: string[]
): string {
  expect(result.status, JSON.stringify(result.json)).toBe(status);
  const message = result.json?.error ?? "";
  expect(message, "error responses must carry a friendly message").not.toBe("");
  for (const needle of substrings) expect(message).toContain(needle);
  expect(message, `friendly error leaked database detail: ${message}`).not.toMatch(LEAK_RE);
  return message;
}
