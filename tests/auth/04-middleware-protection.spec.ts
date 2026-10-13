import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBase,
  completeOnboarding,
  createUser,
  sessionCookieHeader,
  startApp,
  type TestUser,
} from "./_harness";

let fresh: TestUser;
let onboarded: TestUser;
let app: { close: () => Promise<void> };

// startApp() runs `next build` when .next is missing or older than its
// inputs. From a clean checkout that takes well over Vitest's default 10s
// hook timeout, which used to abort the hook and skip every test in this
// file. The timeout is per-hook rather than global so the hermetic suite
// keeps the strict default.
const BUILD_HOOK_TIMEOUT_MS = 5 * 60 * 1000;

beforeAll(async () => {
  app = await startApp();
  fresh = await createUser("fresh");
  onboarded = await createUser("onboard");
  await completeOnboarding(onboarded);
}, BUILD_HOOK_TIMEOUT_MS);

afterAll(async () => {
  if (app) await app.close();
});

describe("P2 — middleware route protection (real Next server, real RLS)", () => {
  it("anonymous /dashboard redirects to /login carrying next", async () => {
    const res = await fetch(`${appBase()}/dashboard`, { redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(res.status);
    // `next` is the middleware's signature: page-level defense-in-depth
    // redirects do not carry it, so this assertion goes red exactly when
    // the middleware gate is removed.
    expect(res.headers.get("location") ?? "").toContain("/login");
    expect(res.headers.get("location") ?? "").toContain("next=%2Fdashboard");
  });

  it("signed-in but un-onboarded user is bounced to /onboarding", async () => {
    const cookie = await sessionCookieHeader(fresh.email, fresh.password);
    const res = await fetch(`${appBase()}/dashboard`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location") ?? "").toContain("/onboarding");
    expect(res.headers.get("location") ?? "").toContain("next=%2Fdashboard");
  });

  // Regression: /onboarding is itself in PROTECTED_PREFIXES, so the
  // un-onboarded branch used to redirect /onboarding -> /onboarding and
  // loop, leaving the form unreachable and signup impossible. The rest of
  // this suite only ever requested /dashboard with redirect:"manual", and
  // the harness completes onboarding with a direct DB write, so nothing
  // exercised this path. Asserting a 200 here is what keeps it closed.
  it("un-onboarded user reaches the onboarding form itself, not a redirect loop", async () => {
    const cookie = await sessionCookieHeader(fresh.email, fresh.password);
    const res = await fetch(`${appBase()}/onboarding`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
  });

  // Regression: /login?next= used to accept any value starting with "/",
  // including the scheme-relative "//example.com", and the router then
  // hard-navigated off-site after a successful login. The page passes the
  // sanitised target to the client LoginForm as the `nextPath` prop, which
  // is serialised into the RSC payload, so it can be read straight out of
  // the rendered HTML. (The raw query string is echoed elsewhere in that
  // payload, so the assertion is on the prop, not on the whole body.)
  function renderedNextPath(html: string): string | null {
    const m = html.match(/nextPath\\?":\\?"([^"\\]*)\\?"/);
    return m ? m[1] : null;
  }

  it("login page keeps a same-site next target", async () => {
    const res = await fetch(`${appBase()}/login?next=%2Fonboarding`, {
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(renderedNextPath(await res.text())).toBe("/onboarding");
  });

  it("login page drops a scheme-relative next target (open redirect)", async () => {
    const res = await fetch(`${appBase()}/login?next=%2F%2Fexample.com`, {
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(renderedNextPath(await res.text())).toBe("/dashboard");
  });

  it.each(["/.//example.com", "/a/..//example.com", "/%2e//example.com"])(
    "login page drops a normalised external target: %s",
    async (input) => {
      const res = await fetch(`${appBase()}/login?next=${encodeURIComponent(input)}`, {
        redirect: "manual",
      });
      expect(res.status).toBe(200);
      expect(renderedNextPath(await res.text())).toBe("/dashboard");
    },
  );

  it("onboarded user gets the dashboard (200)", async () => {
    const cookie = await sessionCookieHeader(onboarded.email, onboarded.password);
    const res = await fetch(`${appBase()}/dashboard`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
  });

  it("signout clears the cookie and the old cookie stops working", async () => {
    const cookie = await sessionCookieHeader(onboarded.email, onboarded.password);
    const before = await fetch(`${appBase()}/dashboard`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(before.status).toBe(200);

    const res = await fetch(`${appBase()}/auth/signout`, {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
    const setCookies = res.headers.getSetCookie().join("\n");
    expect(setCookies).toMatch(/sb-[\w-]*auth-token[^=]*=/);

    // The session was revoked server-side: replaying the pre-signout
    // cookie now lands on /login again — via the middleware, hence the
    // `next` marker.
    const after = await fetch(`${appBase()}/dashboard`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect([302, 303, 307, 308]).toContain(after.status);
    expect(after.headers.get("location") ?? "").toContain("/login");
    expect(after.headers.get("location") ?? "").toContain("next=%2Fdashboard");
  });
});
