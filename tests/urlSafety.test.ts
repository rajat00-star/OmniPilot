import { describe, expect, it } from "vitest";
import { checkUrlStructure, isPrivateIp, validateRedirectChain, validateUrl, UnsafeUrlError } from "../server/security/urlSafety";

const publicDns = async () => ["93.184.216.34"];

describe("URL validation", () => {
  it("accepts public http and https URLs", async () => {
    await expect(validateUrl("https://claude.com/pricing", { resolve: publicDns })).resolves.toBeInstanceOf(URL);
    await expect(validateUrl("http://example.org/a?b=c", { resolve: publicDns })).resolves.toBeInstanceOf(URL);
  });

  it.each([
    ["file:///etc/passwd", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["ftp://example.com/x", "scheme"],
    ["data:text/html,hi", "scheme"],
    ["http://localhost:8787/api", "internal_host"],
    ["http://127.0.0.1/", "private_ip"],
    ["http://10.0.0.5/", "private_ip"],
    ["http://192.168.1.1/", "private_ip"],
    ["http://172.20.0.1/", "private_ip"],
    ["http://169.254.169.254/latest/meta-data/", "private_ip"],
    ["http://metadata.google.internal/computeMetadata/v1/", "internal_host"],
    ["http://[::1]/", "private_ip"],
    ["http://[fd00:ec2::254]/", "private_ip"],
    ["http://[::ffff:127.0.0.1]/", "private_ip"],
    ["http://2130706433/", "private_ip"], // URL parser normalizes to 127.0.0.1,
    ["http://0x7f000001/", "private_ip"],
    ["http://0177.0.0.1/", "private_ip"],
    ["http://router.local/", "internal_host"],
    ["http://intranet/", "internal_host"],
    ["https://user:pass@example.com/", "credentials"],
    ["not a url", "invalid"],
  ])("blocks %s (%s)", (url, code) => {
    try {
      checkUrlStructure(url);
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeUrlError);
      expect((e as UnsafeUrlError).code).toBe(code);
    }
  });

  it("blocks hostnames that resolve to private addresses (DNS rebinding style)", async () => {
    await expect(validateUrl("https://evil.example.com/", { resolve: async () => ["10.1.2.3"] })).rejects.toMatchObject({ code: "private_dns" });
    await expect(validateUrl("https://evil.example.com/", { resolve: async () => ["93.1.1.1", "169.254.169.254"] })).rejects.toMatchObject({ code: "private_dns" });
  });

  it("revalidates every hop of a redirect chain", async () => {
    await expect(validateRedirectChain(["https://a.example.com/", "https://b.example.com/"], { resolve: publicDns })).resolves.toBeUndefined();
    await expect(validateRedirectChain(["https://a.example.com/", "http://169.254.169.254/"], { resolve: publicDns })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("only allows loopback when the test policy explicitly enables it", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.0.0.1", true)).toBe(false);
    expect(isPrivateIp("10.0.0.1", true)).toBe(true);
    expect(() => checkUrlStructure("http://127.0.0.1:3000/", { allowLoopback: true })).not.toThrow();
  });

  // Regression: the URL parser rewrites embedded IPv4 in IPv6 literals to hex ("[64:ff9b::127.0.0.1]" becomes
  // "[64:ff9b::7f00:1]"), and the old matcher only understood the dotted form, so NAT64, IPv4-compatible and
  // 6to4 literals pointing at loopback, private ranges and cloud metadata were accepted.
  it.each([
    ["http://[64:ff9b::127.0.0.1]/", "NAT64 -> loopback"],
    ["http://[64:ff9b::a9fe:a9fe]/", "NAT64 -> 169.254.169.254 metadata"],
    ["http://[64:ff9b::10.0.0.5]/", "NAT64 -> 10.0.0.5"],
    ["http://[::127.0.0.1]/", "IPv4-compatible -> loopback"],
    ["http://[::a9fe:a9fe]/", "IPv4-compatible -> metadata"],
    ["http://[::ffff:0:127.0.0.1]/", "SIIT-translated -> loopback"],
    ["http://[2002:7f00:1::]/", "6to4 -> loopback"],
    ["http://[2002:a9fe:a9fe::1]/", "6to4 -> metadata"],
    ["http://[2002:c0a8:101::1]/", "6to4 -> 192.168.1.1"],
    ["http://[64:ff9b:1::1]/", "local-use NAT64 prefix"],
  ])("blocks IPv6 literal with an embedded private IPv4: %s (%s)", (url) => {
    try {
      checkUrlStructure(url);
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeUrlError);
      expect((e as UnsafeUrlError).code).toBe("private_ip");
    }
  });

  it("still allows IPv6 literals whose embedded IPv4 is public, and ordinary global IPv6", () => {
    for (const ok of ["http://[64:ff9b::8.8.8.8]/", "http://[2002:808:808::1]/", "http://[2606:4700::1111]/", "http://[2a00:1450:4001::1]/"]) {
      expect(() => checkUrlStructure(ok)).not.toThrow();
    }
  });

  it("applies the same rule to addresses returned by DNS (AAAA records)", async () => {
    await expect(validateUrl("https://evil.example.com/", { resolve: async () => ["64:ff9b::7f00:1"] })).rejects.toMatchObject({ code: "private_dns" });
    await expect(validateUrl("https://evil.example.com/", { resolve: async () => ["2002:a9fe:a9fe::1"] })).rejects.toMatchObject({ code: "private_dns" });
    expect(isPrivateIp("::")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("offline demo policy allows only the listed fixture origins", async () => {
    const policy = { allowOnlyOrigins: ["http://127.0.0.1:41001", "http://127.0.0.1:41002"] };
    await expect(validateUrl("http://127.0.0.1:41001/pricing", policy)).resolves.toBeInstanceOf(URL);
    for (const blocked of ["https://claude.com/pricing", "http://127.0.0.1:8787/api/health", "http://127.0.0.1:41003/", "http://localhost:41001/", "https://127.0.0.1:41001/", "http://169.254.169.254/"]) {
      try {
        checkUrlStructure(blocked, policy);
        throw new Error(`not blocked: ${blocked}`);
      } catch (e) {
        expect(e).toBeInstanceOf(UnsafeUrlError);
        expect((e as UnsafeUrlError).code).toBe("offline_mode");
      }
    }
    expect(() => checkUrlStructure("file:///etc/passwd", policy)).toThrow(UnsafeUrlError);
  });
});
