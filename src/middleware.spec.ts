import type { CookieOptions } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

type CookieWrite = { name: string; value: string; options: CookieOptions };
const auth = vi.hoisted(() => ({
  user: { id: "member-id" } as { id: string } | null,
  categoryId: null as number | null,
  writes: [] as CookieWrite[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: { setAll: (cookies: CookieWrite[]) => void };
  }) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll(auth.writes);
        return { data: { user: auth.user } };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { category_id: auth.categoryId } }),
        }),
      }),
    }),
  }),
}));

const refresh: CookieWrite[] = [0, 1].map((chunk) => ({
  name: `sb-test-auth-token.${chunk}`,
  value: `refreshed-chunk-${chunk}`,
  options: {
    path: "/", domain: "example.test", httpOnly: true,
    secure: true, sameSite: "lax", maxAge: 3600,
  },
}));
const deletion: CookieWrite[] = [{
  name: "sb-test-auth-token.0", value: "",
  options: {
    path: "/", domain: "example.test", httpOnly: true,
    secure: true, sameSite: "lax", maxAge: 0, expires: new Date(0),
  },
}];

beforeEach(() => {
  auth.user = { id: "member-id" };
  auth.categoryId = null;
  auth.writes = [];
});

describe("middleware response cookies", () => {
  const routes = [
    { label: "signed-in login", path: "/login?next=/events", target: "/dashboard", signedIn: true },
    { label: "anonymous dashboard", path: "/dashboard", target: "/login?next=%2Fdashboard", signedIn: false },
    { label: "incomplete dashboard", path: "/dashboard", target: "/onboarding?next=%2Fdashboard", signedIn: true },
  ];

  for (const route of routes) {
    for (const [label, writes] of [["refresh", refresh], ["deletion", deletion]] as const) {
      it(`preserves ${label} cookies and options on ${route.label} redirects`, async () => {
        auth.user = route.signedIn ? { id: "member-id" } : null;
        auth.writes = structuredClone(writes);
        const response = await middleware(new NextRequest(`https://example.test${route.path}`));
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe(`https://example.test${route.target}`);
        expect(response.cookies.getAll()).toHaveLength(writes.length);
        for (const cookie of writes) {
          expect(response.cookies.get(cookie.name)).toMatchObject({
            name: cookie.name, value: cookie.value, ...cookie.options,
          });
        }
        const headers = response.headers.getSetCookie();
        expect(headers).toHaveLength(writes.length);
        for (const header of headers) {
          expect(header).toContain("Path=/");
          expect(header).toContain("Domain=example.test");
          expect(header).toContain("Secure");
          expect(header).toContain("HttpOnly");
          expect(header).toContain("SameSite=lax");
          expect(header).toContain(`Max-Age=${label === "deletion" ? 0 : 3600}`);
          if (label === "deletion") expect(header).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
        }
      });
    }
  }

  it("keeps refreshed cookies on the non-redirect onboarding response", async () => {
    auth.writes = structuredClone(refresh);
    const response = await middleware(new NextRequest("https://example.test/onboarding"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.getAll()).toHaveLength(refresh.length);
    for (const cookie of refresh) {
      expect(response.cookies.get(cookie.name)).toMatchObject({ name: cookie.name, value: cookie.value, ...cookie.options });
    }
  });
});
