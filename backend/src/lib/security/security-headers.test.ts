import {
  buildBackendContentSecurityPolicy,
  buildBackendSecurityHeaders,
  parseSecurityHeaderOrigin,
  shouldDefaultToNoStore,
} from "./security-headers";

describe("Backend security headers", () => {
  it("builds a production Admin policy without inline script execution", () => {
    const policy = buildBackendContentSecurityPolicy({
      isDevelopment: false,
      mediaUrls: [
        "https://media.example.com/bucket/path",
        "http://insecure.example.com/bucket/path",
      ],
    });
    const scriptDirective = policy
      .split("; ")
      .find((directive) => directive.startsWith("script-src "));

    expect(scriptDirective).toBe("script-src 'self'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain(
      "img-src 'self' data: blob: https://media.example.com",
    );
    expect(policy).not.toContain("http://insecure.example.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("adds HSTS only outside development", () => {
    const production = buildBackendSecurityHeaders({
      isDevelopment: false,
    });
    const development = buildBackendSecurityHeaders({
      isDevelopment: true,
      mediaUrls: ["http://localhost:9000/uploads"],
    });

    expect(production).toMatchObject({
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    expect(development).not.toHaveProperty("Strict-Transport-Security");
    expect(development["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(development["Content-Security-Policy"]).toContain(
      "http://localhost:9000",
    );
  });

  it("rejects credential-bearing and non-HTTP media origins", () => {
    expect(
      parseSecurityHeaderOrigin("https://user:password@example.com/path"),
    ).toBeNull();
    expect(parseSecurityHeaderOrigin("javascript:alert(1)")).toBeNull();
    expect(parseSecurityHeaderOrigin("media.example.com/path")).toBe(
      "https://media.example.com",
    );
  });

  it("defaults dynamic responses to no-store without disabling asset caching", () => {
    expect(shouldDefaultToNoStore("GET", "/admin/products")).toBe(true);
    expect(shouldDefaultToNoStore("POST", "/store/carts")).toBe(true);
    expect(shouldDefaultToNoStore("GET", "/app/assets/index.js")).toBe(false);
    expect(shouldDefaultToNoStore("HEAD", "/static/cover.jpg")).toBe(false);
  });
});
