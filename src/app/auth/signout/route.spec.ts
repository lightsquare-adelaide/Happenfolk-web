import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

const { POST } = await import("./route");

beforeEach(() => vi.clearAllMocks());

describe("POST /auth/signout", () => {
  it("revokes the session and clears cached member data", async () => {
    const response = await POST(new NextRequest("http://localhost/auth/signout", { method: "POST" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("clear-site-data")).toBe('"cache", "storage"');
  });

  it("rejects a cross-origin form without revoking the session", async () => {
    const response = await POST(new NextRequest("https://happenfolk.example/auth/signout", {
      method: "POST", headers: { origin: "https://other.example" },
    }));
    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
    expect(response.headers.get("clear-site-data")).toBeNull();
  });

  it("rejects cross-site fetch metadata even when Origin is absent", async () => {
    const response = await POST(new NextRequest("https://happenfolk.example/auth/signout", {
      method: "POST", headers: { "sec-fetch-site": "cross-site" },
    }));
    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("accepts the browser origin forwarded by the hosting proxy", async () => {
    const response = await POST(new NextRequest("http://localhost/auth/signout", {
      method: "POST", headers: {
        origin: "https://happenfolk.example", "x-forwarded-host": "happenfolk.example",
        "x-forwarded-proto": "https", "sec-fetch-site": "same-origin",
      },
    }));
    expect(response.status).toBe(303);
    expect(signOut).toHaveBeenCalledOnce();
  });
});
