/**
 * SSRF guards for server-side fetches of user-supplied URLs.
 *
 * Enrichment fetches any URL a user imported, which makes the server a proxy into
 * whatever it can reach: loopback services, private networks, and cloud metadata
 * endpoints like 169.254.169.254 that hand out credentials. Blocking by hostname alone
 * is not enough, because DNS can resolve a public-looking name to a private address
 * and a redirect can move a safe URL onto a dangerous one.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, type Dispatcher } from "undici";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** Hostnames that never point anywhere useful to us. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/** Only these schemes; blocks file:, ftp:, gopher:, data: and friends. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** CIDR blocks that must never be reachable, as [network, prefix] pairs. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata at 169.254.169.254
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const value = ipv4ToInt(ip);
    if (value === null) return true;
    return BLOCKED_V4.some(([network, prefix]) => {
      const base = ipv4ToInt(network);
      if (base === null) return false;
      const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0;
      return (value & mask) === (base & mask);
    });
  }

  if (version === 6) {
    const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (normalized === "::" || normalized === "::1") return true; // unspecified, loopback
    // fe80::/10 spans fe80 through febf, not just addresses beginning with fe80.
    if (/^fe[89ab]/.test(normalized)) return true; // link-local
    if (/^f[cd]/.test(normalized)) return true; // unique local
    if (normalized.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:127.0.0.1) must be judged by its embedded v4 address.
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }

  return true; // not an IP at all
}

/**
 * Validates one URL: scheme, hostname, and every address it resolves to.
 *
 * Checking all resolved addresses matters because a hostname can return both a public
 * and a private record, and picking only the first would let the private one through.
 */
type ResolvedAddress = { address: string; family: 4 | 6 };

type SafeDestination = {
  url: URL;
  addresses: ResolvedAddress[];
};

async function resolveSafeDestination(rawUrl: string): Promise<SafeDestination> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Malformed URL");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError(`Blocked protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) throw new SsrfError("Missing hostname");
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new SsrfError(`Blocked hostname: ${hostname}`);
  if (hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new SsrfError(`Blocked hostname: ${hostname}`);
  }

  // A literal IP needs no DNS round trip.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SsrfError(`Blocked address: ${hostname}`);
    return { url, addresses: [{ address: hostname, family: isIP(hostname) as 4 | 6 }] };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = (await lookup(hostname, { all: true })) as ResolvedAddress[];
  } catch {
    throw new SsrfError(`Could not resolve ${hostname}`);
  }

  if (addresses.length === 0) throw new SsrfError(`Could not resolve ${hostname}`);
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfError(`${hostname} resolves to a blocked address`);
    }
  }

  return { url, addresses };
}

export async function assertUrlIsSafe(rawUrl: string): Promise<URL> {
  return (await resolveSafeDestination(rawUrl)).url;
}

export const MAX_REDIRECTS = 5;

/**
 * fetch() with every hop validated.
 *
 * Redirects are followed manually rather than by the runtime, because `redirect: follow`
 * would let a public URL bounce the request straight to 169.254.169.254 with no chance
 * to inspect it. Each Location is re-validated before it is requested.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 12_000, ...rest } = init;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url, addresses } = await resolveSafeDestination(current);

    // DNS validation and fetch must use the same result. If fetch resolves the hostname a
    // second time, an attacker-controlled domain can return a public address to the check
    // and a private address milliseconds later (DNS rebinding). This per-hop dispatcher
    // pins the connection to one address from the already-validated result while preserving
    // the original hostname for the Host header and TLS certificate/SNI validation.
    const pinned = addresses[0];
    const dispatcher = new Agent({
      connect: {
        lookup(_hostname, options, callback) {
          const family = typeof options.family === "string"
            ? Number(options.family.slice(-1))
            : options.family;
          if (family && family !== pinned.family) {
            const error = new Error(`Validated address family ${pinned.family} is unavailable`);
            Object.assign(error, { code: "ENOTFOUND" });
            callback(error as NodeJS.ErrnoException, pinned.address, pinned.family);
            return;
          }
          if (options.all) {
            callback(null, [pinned], pinned.family);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      const signal = rest.signal
        ? AbortSignal.any([rest.signal, controller.signal])
        : controller.signal;
      response = await fetch(url, {
        ...rest,
        redirect: "manual",
        signal,
        dispatcher,
      } as RequestInit & { dispatcher: Dispatcher });
    } catch (error) {
      await dispatcher.destroy(error instanceof Error ? error : new Error("Fetch failed"));
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 300 || response.status > 399) {
      return closeDispatcherWithBody(response, dispatcher);
    }

    const location = response.headers.get("location");
    if (!location) return closeDispatcherWithBody(response, dispatcher);

    await response.body?.cancel();
    await dispatcher.close();

    // Relative Locations resolve against the URL we just fetched.
    current = new URL(location, url).toString();
  }

  throw new SsrfError(`Too many redirects (>${MAX_REDIRECTS})`);
}

/** Close the one-use dispatcher once the caller consumes or cancels the response body. */
function closeDispatcherWithBody(response: Response, dispatcher: Agent): Response {
  if (!response.body) {
    void dispatcher.close();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          await dispatcher.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        controller.error(error);
        await dispatcher.destroy(error instanceof Error ? error : new Error("Body read failed"));
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await dispatcher.destroy();
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
