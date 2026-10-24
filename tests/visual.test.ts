import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BrowserManager } from "../server/browser/browserManager";
import { visualChecks } from "../server/core/verifier";
import type { ArtifactRecord, CheckResult } from "../server/core/types";
import { tempDir } from "./helpers/fixtures";

const browser = new BrowserManager({}, { headed: false, navTimeoutMs: 5000 });
const dir = tempDir();
afterAll(() => browser.shutdown());

const art = { id: "art_x" } as ArtifactRecord;
async function check(html: string, name: string) {
  const r = await browser.renderHtml(html, path.join(dir, `${name}.png`));
  const out: Omit<CheckResult, "id">[] = [];
  visualChecks(art, r, (c) => out.push(c));
  return { r, by: (n: string) => out.find((c) => c.name === n)! };
}

const GOOD = `<html><body style="margin:0;background:#0f1115;color:#e8eaf0;font-family:sans-serif">
  <header style="padding:40px"><h1>VerityDesk: research you can verify</h1><p class="sub" style="color:#c9ceda">Every answer comes with sources.</p>
  <a class="cta" href="#p" style="background:#4b49d6;color:#fff;padding:12px">Join early access</a></header>${"<section><p>More text here.</p></section>".repeat(3)}</body></html>`;

describe("visual verification of rendered artifacts", () => {
  it("passes a legible page with hero above the fold", async () => {
    const { r, by } = await check(GOOD, "good");
    expect(r.pixels.width).toBe(1280);
    expect(by("Screenshot is not blank").status).toBe("passed");
    expect(by("Headline and call to action above the fold").status).toBe("passed");
    expect(by("Text contrast meets WCAG AA").status).toBe("passed");
  });

  it("fails a blank render", async () => {
    const { by } = await check(`<html><body style="background:#fff"><h1 style="color:#fff">x</h1><a class="cta" href="#" style="color:#fff">y</a></body></html>`, "blank");
    expect(by("Screenshot is not blank").status).toBe("failed");
    expect(by("Text contrast meets WCAG AA").status).toBe("warning");
  });

  it("fails when the headline is pushed below the fold", async () => {
    const { by } = await check(`<html><body><div style="height:1400px"></div><h1>Late headline</h1><a class="cta" href="#">Go</a></body></html>`, "fold");
    expect(by("Headline and call to action above the fold").status).toBe("failed");
  });

  it("measures pixel statistics of stored screenshots", async () => {
    await browser.renderHtml(GOOD, path.join(dir, "stats.png"));
    const s = await browser.imageStats(path.join(dir, "stats.png"));
    expect(s.lumaStd).toBeGreaterThan(6);
    expect(s.nonUniformShare).toBeGreaterThan(0.005);
  });
});
