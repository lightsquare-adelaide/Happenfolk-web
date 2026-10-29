import { describe, expect, it } from "vitest";
import {
  anonViewAllowed,
  forwardedTrustMode,
  isValidClientIp,
  isValidForwardedUserAgent,
  isViewSubjectId,
  isViewSubjectType,
  readBoundedBody,
  trustedClientIp,
  utf8ByteLength,
  viewThrottleKey,
  VIEW_BODY_LIMIT_BYTES,
  VIEW_THROTTLE_MAX_ENTRIES,
  VIEW_THROTTLE_WINDOW_MS,
} from "./view-throttle";

/**
 * DB-free unit tests for the S2 view-recording rules. The integration
 * behaviour against the ACTUAL /api/views route (real Next server, real
 * PostgREST identity forwarding, real page_views rows) is exercised in
 * tests/discovery/05-view-api.spec.ts.
 */

const headers = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});

describe("subject validation", () => {
  it("accepts exactly the three subject types", () => {
    expect(isViewSubjectType("event")).toBe(true);
    expect(isViewSubjectType("profile")).toBe(true);
    expect(isViewSubjectType("portfolio_item")).toBe(true);
    expect(isViewSubjectType("user")).toBe(false);
    expect(isViewSubjectType("")).toBe(false);
    expect(isViewSubjectType(42)).toBe(false);
    expect(isViewSubjectType(null)).toBe(false);
  });

  it("accepts only canonical UUIDs", () => {
    expect(isViewSubjectId("0e8a1c66-9b04-4f6a-9c8e-2b7a1f0d4c11")).toBe(true);
    expect(isViewSubjectId("not-a-uuid")).toBe(false);
    expect(isViewSubjectId("0e8a1c66-9b04-4f6a-9c8e-2b7a1f0d4c1")).toBe(false); // 35 chars
    expect(isViewSubjectId("")).toBe(false);
    expect(isViewSubjectId(undefined)).toBe(false);
  });

  it("measures UTF-8 bytes, not characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("\u00e9")).toBe(2);
    expect(utf8ByteLength("\u20ac")).toBe(3);
  });
});

describe("trusted proxy mode", () => {
  it("is off unless the platform or the documented opt-in says otherwise", () => {
    expect(forwardedTrustMode({})).toBe("off");
    expect(forwardedTrustMode({ VERCEL: "0" })).toBe("off");
    expect(forwardedTrustMode({ VIEW_RECORDING_TRUST_FORWARDED_FOR: "yes" })).toBe("off");
    expect(forwardedTrustMode({ VERCEL: "1" })).toBe("vercel");
    expect(forwardedTrustMode({ VIEW_RECORDING_TRUST_FORWARDED_FOR: "1" })).toBe("proxy");
    expect(forwardedTrustMode({ VERCEL: "1", VIEW_RECORDING_TRUST_FORWARDED_FOR: "1" })).toBe("vercel");
  });

  it("returns no client IP in untrusted mode even with perfect headers", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.7", "x-vercel-forwarded-for": "203.0.113.7" });
    expect(trustedClientIp(h, "off")).toBeNull();
  });

  it("takes the leftmost, trimmed entry in proxy mode", () => {
    const h = headers({ "x-forwarded-for": " 203.0.113.7 , 70.41.3.18, 150.172.238.178" });
    expect(trustedClientIp(h, "proxy")).toBe("203.0.113.7");
  });

  it("prefers the dedicated Vercel header in vercel mode", () => {
    const h = headers({
      "x-vercel-forwarded-for": "198.51.100.9",
      "x-forwarded-for": "203.0.113.7",
    });
    expect(trustedClientIp(h, "vercel")).toBe("198.51.100.9");
  });

  it("does NOT trust a client-supplied x-vercel header in proxy mode", () => {
    const h = headers({
      "x-vercel-forwarded-for": "198.51.100.9",
      "x-forwarded-for": "203.0.113.7",
    });
    // Proxy mode only reads x-forwarded-for (which the operator's proxy
    // must strip/overwrite); the vercel-named header is ignored.
    expect(trustedClientIp(h, "proxy")).toBe("203.0.113.7");
  });

  it("rejects malformed, missing or over-long values", () => {
    expect(trustedClientIp(headers({}), "proxy")).toBeNull();
    expect(trustedClientIp(headers({ "x-forwarded-for": "" }), "proxy")).toBeNull();
    expect(trustedClientIp(headers({ "x-forwarded-for": "localhost" }), "proxy")).toBeNull();
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113" }), "proxy")).toBeNull();
    expect(trustedClientIp(headers({ "x-forwarded-for": "999.1.1.1" }), "proxy")).toBeNull();
    expect(trustedClientIp(headers({ "x-forwarded-for": "2001:db8::1" }), "proxy")).toBe("2001:db8::1");
    expect(isValidClientIp("x".repeat(46))).toBe(false);
    expect(isValidClientIp("::ffff:192.168.1.1")).toBe(true);
  });
});

describe("user-agent bounds", () => {
  it("rejects empty, control-character and over-512-byte agents", () => {
    expect(isValidForwardedUserAgent("")).toBe(false);
    expect(isValidForwardedUserAgent("Mozilla/5.0 (Test)")).toBe(true);
    expect(isValidForwardedUserAgent("bad\u0000agent")).toBe(false);
    expect(isValidForwardedUserAgent("bad\nagent")).toBe(false);
    expect(isValidForwardedUserAgent("a".repeat(512))).toBe(true);
    expect(isValidForwardedUserAgent("a".repeat(513))).toBe(false);
    expect(isValidForwardedUserAgent("\u00e9".repeat(257))).toBe(false); // 514 bytes
  });
});

describe("hashed throttle keys", () => {
  const ua = "Mozilla/5.0 (S2 Test)";

  it("is deterministic and never contains the raw identity", () => {
    const k1 = viewThrottleKey("event", "id-1", "203.0.113.7", ua);
    const k2 = viewThrottleKey("event", "id-1", "203.0.113.7", ua);
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(32);
    expect(k1).not.toContain("203.0.113.7");
    expect(k1).not.toContain("Mozilla");
    expect(k1).not.toContain("id-1");
  });

  it("separates every identity and subject component (no subnet collapse)", () => {
    const base = viewThrottleKey("event", "id-1", "203.0.113.7", ua);
    // Same /24 subnet, different host: MUST differ (no subnet-global suppression).
    expect(viewThrottleKey("event", "id-1", "203.0.113.8", ua)).not.toBe(base);
    expect(viewThrottleKey("event", "id-1", "203.0.113.7", `${ua} x`)).not.toBe(base);
    expect(viewThrottleKey("event", "id-2", "203.0.113.7", ua)).not.toBe(base);
    expect(viewThrottleKey("profile", "id-1", "203.0.113.7", ua)).not.toBe(base);
  });
});

describe("bounded in-memory throttle", () => {
  it("allows once per window per key with injectable time", () => {
    const t0 = 1_000_000_000_000;
    const key = viewThrottleKey("event", `throttle-window-${t0}`, "192.0.2.1", "UA");
    expect(anonViewAllowed(key, t0)).toBe(true);
    expect(anonViewAllowed(key, t0 + 1_000)).toBe(false);
    expect(anonViewAllowed(key, t0 + VIEW_THROTTLE_WINDOW_MS - 1)).toBe(false);
    expect(anonViewAllowed(key, t0 + VIEW_THROTTLE_WINDOW_MS)).toBe(true);
  });

  it("keeps distinct identities independent", () => {
    const t0 = 2_000_000_000_000;
    const a = viewThrottleKey("event", `throttle-indep-${t0}`, "192.0.2.10", "UA");
    const b = viewThrottleKey("event", `throttle-indep-${t0}`, "192.0.2.11", "UA");
    expect(anonViewAllowed(a, t0)).toBe(true);
    expect(anonViewAllowed(b, t0)).toBe(true); // not suppressed by a's hit
  });

  it("stays bounded: the hard cap evicts oldest entries", () => {
    const t0 = 3_000_000_000_000;
    const first = `cap-first-${t0}`;
    expect(anonViewAllowed(first, t0)).toBe(true);
    for (let i = 0; i < VIEW_THROTTLE_MAX_ENTRIES; i += 1) {
      anonViewAllowed(`cap-fill-${t0}-${i}`, t0);
    }
    // `first` was the oldest entry and had to be evicted by the cap.
    expect(anonViewAllowed(first, t0)).toBe(true);
  });
});

describe("readBoundedBody", () => {
  function countingStream(chunks: number, chunkSize: number, onPull: () => void): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        onPull();
        if (sent >= chunks) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(new Uint8Array(chunkSize).fill(0x61));
      },
    });
  }

  it("returns the full text for bodies within the limit", async () => {
    const req = new Request("http://localhost/api/views", {
      method: "POST",
      body: '{"subjectType":"event","subjectId":"x"}',
    });
    const body = await readBoundedBody(req);
    expect(body).toBe('{"subjectType":"event","subjectId":"x"}');
  });

  it("accepts a body of exactly the limit", async () => {
    const exact = "a".repeat(VIEW_BODY_LIMIT_BYTES);
    const req = new Request("http://localhost/api/views", { method: "POST", body: exact });
    expect(await readBoundedBody(req)).toBe(exact);
  });

  it("rejects one byte over the limit", async () => {
    const over = "a".repeat(VIEW_BODY_LIMIT_BYTES + 1);
    const req = new Request("http://localhost/api/views", { method: "POST", body: over });
    expect(await readBoundedBody(req)).toBeNull();
  });

  it("STOPS reading and cancels an oversized stream instead of buffering it", async () => {
    let pulls = 0;
    const totalChunks = 64; // 64 * 256 = 16 KiB >> 1 KiB limit
    const req = new Request("http://localhost/api/views", {
      method: "POST",
      body: countingStream(totalChunks, 256, () => {
        pulls += 1;
      }),
      duplex: "half",
    } as RequestInit);
    expect(await readBoundedBody(req)).toBeNull();
    // 1 KiB limit / 256 B chunks = 4 tolerated + 1 that trips the bound.
    expect(pulls).toBeLessThanOrEqual(6);
    expect(pulls).toBeLessThan(totalChunks);
  });

  it("returns null on a stream that errors mid-flight", async () => {
    const req = new Request("http://localhost/api/views", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(10).fill(0x61));
          controller.error(new Error("network gone"));
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await readBoundedBody(req)).toBeNull();
  });

  it("rejects an endless oversized body without waiting for cancellation", async () => {
    let cancelled = false;
    const req = new Request("http://localhost/api/views", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2048));
        },
        cancel() {
          cancelled = true;
          // An upstream producer need not acknowledge cancellation promptly.
          return new Promise<void>(() => {});
        },
      }),
      duplex: "half",
    } as RequestInit);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        readBoundedBody(req),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("timed out"), 200);
        }),
      ]);
      expect(result).toBeNull();
      expect(cancelled).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });
});
