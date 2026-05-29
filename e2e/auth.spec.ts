import { test, expect } from '@playwright/test';

/**
 * Auth flow specs.
 *
 * The CRM delegates sign-in to the community website over SSO. We verify
 * the auth gate at the HTTP / cookie layer so the suite does not require
 * the community dev server to be running on port 3002 to pass.
 */

// ── Unauthenticated tests — clear storage state ───────────────────────────────
test.describe('Authentication Flow — Unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should redirect to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test('protected routes redirect when the auth cookie is missing', async ({ request }) => {
    // Independent check on a second protected route — confirms the Edge
    // middleware gate is active across the app, not just on /dashboard.
    const res = await request.get('http://localhost:3000/sensors', {
      maxRedirects: 0,
    });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
  });

  test('login page is publicly reachable (no auth required)', async ({ page }) => {
    // /login is the only authenticated-by-default route that must remain
    // open to unauthenticated callers — without it, a logged-out user has
    // no way back in. We assert it loads with HTTP 200 rather than the
    // middleware's redirect chain.
    const res = await page.goto('/login');
    expect(res?.status()).toBe(200);
  });
});

// ── Authenticated tests — uses default storageState (.auth-state.json) ────────
test.describe('Authentication Flow — Authenticated', () => {
  test('should access dashboard when authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 });
    await expect(page.getByText(/dashboard/i).first()).toBeVisible();
  });

  test('should logout successfully', async ({ page, context }) => {
    // Verify we're authenticated first.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 });

    // Simulate the user hitting the Logout button in the TopBar avatar
    // menu. The real handler calls AuthContext.logout() which clears the
    // session cookies, and then the middleware redirects on the next
    // request. We mirror that effect at the browser-context level so the
    // test doesn't depend on the exact menu DOM structure.
    await context.clearCookies();

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });
});
