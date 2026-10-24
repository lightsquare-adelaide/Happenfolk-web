import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

const { POST } = await import("./route");

describe("POST /auth/signout", () => {
  it("revokes the session and clears cached member data", async () => {
    const response = await POST(new NextRequest("http://localhost/auth/signout", { method: "POST" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("clear-site-data")).toBe('"cache", "storage"');
  });
});
