import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordView } from "@/components/view-tracker";

let store: Storage;

beforeEach(() => {
  const entries = new Map<string, string>();
  store = {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
    clear: () => { entries.clear(); },
  };
  vi.stubGlobal("window", { sessionStorage: store });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("view tracker delivery and suppression", () => {
  it("retries on the next call after a network failure", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    recordView("event", "network-retry");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getItem("happenfolk:views:event:network-retry")).toBeNull();
    recordView("event", "network-retry");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.getItem("happenfolk:views:event:network-retry")).not.toBeNull());
  });

  it("retries a non-success HTTP response without a 30-minute suppression", async () => {
    const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", send);
    recordView("profile", "http-retry");
    // Flush the fetch handler and its cleanup before the next call.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getItem("happenfolk:views:profile:http-retry")).toBeNull();
    recordView("profile", "http-retry");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.getItem("happenfolk:views:profile:http-retry")).not.toBeNull());
  });

  it("coalesces pending calls, then suppresses successful views for 30 minutes", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const send = vi.fn().mockReturnValueOnce(pending)
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    recordView("portfolio_item", "pending");
    recordView("portfolio_item", "pending");
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getItem("happenfolk:views:portfolio_item:pending")).toBeNull();
    resolve(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(store.getItem("happenfolk:views:portfolio_item:pending")).not.toBeNull());
    recordView("portfolio_item", "pending");
    expect(send).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 30 * 60 * 1000);
    recordView("portfolio_item", "pending");
    expect(send).toHaveBeenCalledTimes(2);
    await new Promise((done) => setTimeout(done, 0));
  });

  it("fails open when sessionStorage and fetch throw", async () => {
    vi.stubGlobal("window", { get sessionStorage() { throw new Error("private mode"); } });
    const send = vi.fn().mockImplementationOnce(() => { throw new Error("unavailable"); })
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    expect(() => recordView("event", "storage-failure")).not.toThrow();
    recordView("event", "storage-failure");
    expect(send).toHaveBeenCalledTimes(2);
    await new Promise((done) => setTimeout(done, 0));
  });
});
