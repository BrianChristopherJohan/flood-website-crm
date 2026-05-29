/**
 * CRM smoke test — under 15s, proves the operator console is healthy
 * end-to-end without depending on Java backend availability.
 *
 * Tests the actual CRM architecture:
 *   • /login is a SERVER-SIDE REDIRECT to the community site
 *     (single sign-in surface). Cypress can't follow cross-origin
 *     redirects to localhost:3002 in test mode, so we assert the
 *     redirect itself rather than the destination form.
 *   • Every gated route bounces unauthenticated visitors to /login
 *     via middleware (which then redirects to community).
 *   • /api/auth/me returns 401 without a session cookie.
 *
 * Note: this CRM has no /api/zones (deferred per the plan
 * addendum — operator map uses /api/iot/* directly). Removed
 * the earlier check that assumed it existed.
 */

describe("CRM smoke", () => {
  it("/login emits a redirect to the community site", () => {
    // Next.js App Router `redirect()` to a cross-origin URL does NOT
    // emit a true HTTP 307 to plain HTTP clients — it returns 200 with
    // an HTML shell containing an RSC NEXT_REDIRECT directive that the
    // client executes after hydration. Both responses are valid; we
    // accept either and verify the target is community.
    cy.request({
      url: "/login",
      followRedirect: false,
      failOnStatusCode: false,
    }).then((res) => {
      const isHttpRedirect = [302, 307, 308].includes(res.status);
      const isRscRedirect =
        res.status === 200 &&
        /NEXT_REDIRECT/.test(res.body) &&
        /localhost:3002|community/i.test(res.body);
      expect(isHttpRedirect || isRscRedirect, "redirect to community").to.be.true;
    });
  });

  it("/dashboard redirects unauthenticated visitors", () => {
    cy.request({
      url: "/dashboard",
      followRedirect: false,
      failOnStatusCode: false,
    }).then((res) => {
      // Middleware bounces unauthenticated → /login (which then 307s
      // to community). Either is acceptable at the first hop.
      expect(res.status).to.be.oneOf([302, 307, 308]);
      expect(res.headers.location).to.match(/\/login|community/i);
    });
  });

  it("/sensors redirects unauthenticated visitors", () => {
    cy.request({
      url: "/sensors",
      followRedirect: false,
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.be.oneOf([302, 307, 308]);
      expect(res.headers.location).to.match(/\/login|community/i);
    });
  });

  it("BFF /api/auth/me returns 401 without a session cookie", () => {
    cy.request({
      url: "/api/auth/me",
      failOnStatusCode: false,
      timeout: 10_000,
    }).then((res) => {
      expect(res.status).to.eq(401);
    });
  });

  it("BFF /api/iot/nodes proxies the upstream IoT API (or fails clean)", () => {
    // Public route — no auth gate. Either succeeds (200) or returns
    // a clean BFF error (502/503) if upstream is unreachable.
    cy.request({
      url: "/api/iot/nodes",
      failOnStatusCode: false,
      timeout: 15_000,
    }).then((res) => {
      expect(res.status).to.be.oneOf([200, 502, 503]);
    });
  });
});
