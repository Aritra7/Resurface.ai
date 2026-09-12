import { describe, expect, it } from "vitest";
import { assertUrlIsSafe, isBlockedIp, safeFetch, SsrfError } from "../ssrf";

describe("isBlockedIp", () => {
  it("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.1.2.3")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks the cloud metadata address", () => {
    // The one that hands out IAM credentials on AWS, GCP and Azure.
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  it("blocks link-local, CGNAT, multicast and reserved", () => {
    expect(isBlockedIp("169.254.1.1")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("240.0.0.1")).toBe(true);
    expect(isBlockedIp("0.0.0.0")).toBe(true);
  });

  it("blocks IPv6 unique-local and link-local", () => {
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("febf::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 loopback, which bypasses a naive v4-only check", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("2606:4700::1")).toBe(false);
  });

  it("treats a non-address as blocked", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });

  it("does not confuse near-miss ranges with private ones", () => {
    // 172.32.x is public even though 172.16-31 is not.
    expect(isBlockedIp("172.32.0.1")).toBe(false);
    expect(isBlockedIp("11.0.0.1")).toBe(false);
  });
});

describe("assertUrlIsSafe - direct SSRF", () => {
  it("rejects non-http protocols", async () => {
    await expect(assertUrlIsSafe("file:///etc/passwd")).rejects.toThrow(SsrfError);
    await expect(assertUrlIsSafe("ftp://example.com")).rejects.toThrow(SsrfError);
    await expect(assertUrlIsSafe("data:text/html,<script>")).rejects.toThrow(SsrfError);
  });

  it("rejects localhost by name and by address", async () => {
    await expect(assertUrlIsSafe("http://localhost:3000/admin")).rejects.toThrow(SsrfError);
    await expect(assertUrlIsSafe("http://127.0.0.1/")).rejects.toThrow(SsrfError);
    await expect(assertUrlIsSafe("http://[::1]/")).rejects.toThrow(SsrfError);
  });

  it("rejects the cloud metadata endpoint", async () => {
    await expect(assertUrlIsSafe("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      SsrfError,
    );
    await expect(assertUrlIsSafe("http://metadata.google.internal/")).rejects.toThrow(SsrfError);
  });

  it("rejects private network addresses", async () => {
    await expect(assertUrlIsSafe("http://10.0.0.5/")).rejects.toThrow(SsrfError);
    await expect(assertUrlIsSafe("http://192.168.0.1/")).rejects.toThrow(SsrfError);
  });

  it("rejects malformed input", async () => {
    await expect(assertUrlIsSafe("not a url")).rejects.toThrow(SsrfError);
  });

  it("allows a public https URL", async () => {
    const url = await assertUrlIsSafe("https://example.com/page");
    expect(url.hostname).toBe("example.com");
  });
});

describe("safeFetch - redirect-based SSRF", () => {
  it("re-validates each hop and refuses a redirect into link-local space", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })) as typeof fetch;

    try {
      // The first hop is public and allowed; the Location is not, and must be caught
      // before it is requested. redirect:"follow" would have fetched it silently.
      await expect(safeFetch("https://example.com/redirector")).rejects.toThrow(SsrfError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses a redirect to loopback", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 301, headers: { location: "http://127.0.0.1:22/" } })) as typeof fetch;

    try {
      await expect(safeFetch("https://example.com/r")).rejects.toThrow(SsrfError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("stops after too many redirects", async () => {
    const original = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/hop${n}` },
      });
    }) as typeof fetch;

    try {
      await expect(safeFetch("https://example.com/start")).rejects.toThrow(/Too many redirects/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns a normal response without redirecting", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as typeof fetch;

    try {
      const response = await safeFetch("https://example.com/page");
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("pins the request through a dispatcher instead of resolving DNS again", async () => {
    const original = globalThis.fetch;
    let suppliedDispatcher = false;
    globalThis.fetch = (async (_url, init) => {
      suppliedDispatcher = Boolean((init as RequestInit & { dispatcher?: unknown })?.dispatcher);
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    try {
      const response = await safeFetch("https://example.com/page");
      expect(await response.text()).toBe("ok");
      expect(suppliedDispatcher).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
