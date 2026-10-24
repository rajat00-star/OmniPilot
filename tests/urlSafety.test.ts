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
});
