import { describe, expect, it } from "vitest";
import { originProblem } from "./request";
import { MAX_UPLOAD_BYTES, validateUpload } from "./validate";

describe("deployment upload budget", () => {
  it("rejects files above 4 MiB before they can exceed Vercel's request limit", () => {
    const bytes = new Uint8Array(4 * 1024 * 1024 + 1); bytes.set([0xff, 0xd8, 0xff]);
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(validateUpload(bytes, "large.jpg").ok).toBe(false);
  });
});

describe("same-origin browser uploads", () => {
  // Found in the 2026-10-13 browser walkthrough: next start normalizes
  // request.url to localhost while the page is served on 127.0.0.1, so
  // every real browser upload was rejected as cross-origin. The Host
  // the client actually used must count as same-origin.
  it("accepts an Origin that matches the host header even when request.url disagrees", () => {
    const request = new Request("http://localhost:3210/api/media/avatar", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3210", host: "127.0.0.1:3210" },
    });
    expect(originProblem(request)).toBeNull();
  });

  it("accepts the forwarded host behind a proxy", () => {
    const request = new Request("http://localhost:3000/api/media/upload", {
      method: "POST",
      headers: {
        origin: "https://happenfolk.example",
        "x-forwarded-host": "happenfolk.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(originProblem(request)).toBeNull();
  });

  it("still rejects a foreign origin (CSRF)", () => {
    const request = new Request("http://localhost:3210/api/media/avatar", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "127.0.0.1:3210" },
    });
    const rejected = originProblem(request);
    expect(rejected?.status).toBe(403);
  });

  it("ignores the check entirely when no Origin is present", () => {
    const request = new Request("http://localhost:3210/api/media/avatar", { method: "POST" });
    expect(originProblem(request)).toBeNull();
  });
});
