import { describe, expect, it } from "vitest";
import { DEV_CSP, metaCsp, PRODUCTION_CSP } from "./csp";

describe("content security policy", () => {
  it("allows no eval, plugins, <base>, forms or framing in production", () => {
    expect(PRODUCTION_CSP).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(PRODUCTION_CSP).not.toContain("'unsafe-eval'");
    expect(PRODUCTION_CSP).not.toContain("script-src 'self' 'unsafe-inline'");
    for (const csp of [PRODUCTION_CSP, DEV_CSP]) {
      for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) {
        expect(csp).toContain(`${directive};`);
      }
    }
  });

  it("leaves frame-ancestors out of the <meta> policy, where browsers ignore it", () => {
    const meta = metaCsp(PRODUCTION_CSP);
    expect(meta).not.toContain("frame-ancestors");
    expect(meta).toContain("base-uri 'none';");
    expect(`${meta} frame-ancestors 'none';`).toBe(PRODUCTION_CSP);
  });
});
