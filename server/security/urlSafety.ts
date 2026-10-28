import dns from "node:dns/promises";
import net from "node:net";

export interface UrlPolicy {
  /** Test-only escape hatch so fixture servers on 127.0.0.1 can be exercised. Never set from user input. */
  allowLoopback?: boolean;
  /**
   * Offline demo mode: only these exact origins (e.g. "http://127.0.0.1:41001") may be opened, and
   * everything else, including the public web, is blocked. Set by the demo launcher, never from user input.
   */
  allowOnlyOrigins?: string[];
  /** Override DNS for tests. */
  resolve?: (host: string) => Promise<string[]>;
}

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function inV4Cidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const V4_BLOCKED = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16", // link-local incl. cloud metadata 169.254.169.254
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

/** Expand an IPv6 literal (hex or trailing dotted-quad) into eight 16-bit groups, or null when malformed. */
function expandIpv6(ip: string): number[] | null {
  let text = ip.split("%")[0];
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[2].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return [hi >>> 8, hi & 255, lo >>> 8, lo & 255].join(".");
}

/** The IPv4 address embedded in an IPv6 address by a transition mechanism, if any. */
function embeddedIpv4(g: number[]): string | null {
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(5) && g[5] === 0xffff) return v4FromGroups(g[6], g[7]); // ::ffff:0:0/96 IPv4-mapped
  if (zeroTo(4) && g[4] === 0xffff && g[5] === 0) return v4FromGroups(g[6], g[7]); // ::ffff:0:0:0/96 SIIT
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4FromGroups(g[6], g[7]); // 64:ff9b::/96 NAT64
  if (g[0] === 0x2002) return v4FromGroups(g[1], g[2]); // 2002::/16 6to4
  if (zeroTo(6) && (g[6] !== 0 || g[7] > 1)) return v4FromGroups(g[6], g[7]); // ::/96 IPv4-compatible (not :: or ::1)
  return null;
}

export function isPrivateIp(ip: string, allowLoopback = false): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    if (allowLoopback && inV4Cidr(ip, "127.0.0.0/8")) return false;
    return V4_BLOCKED.some((c) => inV4Cidr(ip, c));
  }
  if (family === 6) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::1") return !allowLoopback;
    if (lower === "::") return true;
    // Addresses that embed an IPv4 address (mapped, compatible, NAT64, SIIT, 6to4): judge the embedded address.
    // The URL parser rewrites "[64:ff9b::127.0.0.1]" to "[64:ff9b::7f00:1]", so this must work on the hex form.
    const groups = expandIpv6(lower);
    if (groups) {
      if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
      const embedded = embeddedIpv4(groups);
      if (embedded) return isPrivateIp(embedded, allowLoopback);
    }
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith("2001:db8")) return true; // documentation
    if (lower.startsWith("fd00:ec2::254")) return true; // AWS IMDS v6
    return false;
  }
  return false;
}

/** Synchronous structural checks: scheme, credentials, hostname shape, literal IPs. */
export function checkUrlStructure(raw: string, policy: UrlPolicy = {}): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new UnsafeUrlError("URL is empty or too long", String(raw), "invalid");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("URL could not be parsed", raw, "invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Scheme ${url.protocol} is not permitted (http/https only)`, raw, "scheme");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not permitted", raw, "credentials");
  }
  if (policy.allowOnlyOrigins) {
    if (policy.allowOnlyOrigins.includes(url.origin)) return url;
    throw new UnsafeUrlError(`Offline demo mode: only the local demo fixture sites can be opened (${url.origin} is blocked)`, raw, "offline_mode");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("URL has no host", raw, "invalid");
  if (net.isIP(host)) {
    if (isPrivateIp(host, policy.allowLoopback)) {
      throw new UnsafeUrlError(`Private, loopback or metadata address ${host} is blocked`, raw, "private_ip");
    }
    return url;
  }
  if (policy.allowLoopback && host === "localhost") return url;
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError(`Host ${host} is a local or internal name and is blocked`, raw, "internal_host");
  }
  // Numeric-looking hosts such as "2130706433" or "0x7f000001" are alternate IPv4 encodings.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host) || /^[0-9.]+$/.test(host)) {
    throw new UnsafeUrlError(`Ambiguous numeric host ${host} is blocked`, raw, "numeric_host");
  }
  if (!host.includes(".")) {
    throw new UnsafeUrlError(`Single-label host ${host} is blocked`, raw, "internal_host");
  }
  return url;
}

const dnsCache = new Map<string, { at: number; addrs: string[] }>();

async function defaultResolve(host: string): Promise<string[]> {
  const cached = dnsCache.get(host);
  if (cached && Date.now() - cached.at < 60_000) return cached.addrs;
  const res = await dns.lookup(host, { all: true, verbatim: true });
  const addrs = res.map((r) => r.address);
  dnsCache.set(host, { at: Date.now(), addrs });
  return addrs;
}

/**
 * Full validation: structure plus DNS resolution. Every resolved address must be public.
 * DNS failures are not treated as unsafe here because an egress proxy may resolve names
 * on our behalf; the browser will then fail the navigation and we report that honestly.
 */
export async function validateUrl(raw: string, policy: UrlPolicy = {}): Promise<URL> {
  const url = checkUrlStructure(raw, policy);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return url;
  let addrs: string[] = [];
  try {
    addrs = await (policy.resolve ?? defaultResolve)(host);
  } catch {
    return url;
  }
  for (const a of addrs) {
    if (isPrivateIp(a, policy.allowLoopback)) {
      throw new UnsafeUrlError(`Host ${host} resolves to a private address (${a})`, raw, "private_dns");
    }
  }
  return url;
}

/** Validate every hop of a redirect chain plus the final URL. */
export async function validateRedirectChain(chain: string[], policy: UrlPolicy = {}): Promise<void> {
  for (const hop of chain) await validateUrl(hop, policy);
}
