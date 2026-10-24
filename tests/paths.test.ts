import { describe, expect, it } from "vitest";
import path from "node:path";
import { assertSafeId, resolveInside, UnsafePathError } from "../server/security/paths";

describe("artifact path confinement", () => {
  const root = path.resolve("/tmp/omnipilot-root");
  it("resolves safe names inside the root", () => {
    expect(resolveInside(root, "report.md")).toBe(path.join(root, "report.md"));
    expect(resolveInside(root, "sources/src_1.txt")).toBe(path.join(root, "sources/src_1.txt"));
  });
  it.each(["../escape.md", "sources/../../x", "/etc/passwd", "a/b/c.txt", "..", ".hidden", "a\\b", "x\0.md", ""])("rejects %j", (p) => {
    expect(() => resolveInside(root, p)).toThrow(UnsafePathError);
  });
  it("validates mission ids", () => {
    expect(assertSafeId("msn_abc123")).toBe("msn_abc123");
    expect(() => assertSafeId("../../etc")).toThrow(UnsafePathError);
  });
});
