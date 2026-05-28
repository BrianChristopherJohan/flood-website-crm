import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  });

  test('should display dashboard with KPI cards', async ({ page }) => {
    await expect(page.getByText(/Dashboard/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Total Nodes/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Water Level Status/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display sensor table', async ({ page }) => {
    await expect(page.getByText(/Node ID/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Water Level/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display map component', async ({ page }) => {
    // Map section heading is always present; the actual map canvas may not
    // load in headless browsers without a valid Google Maps key
    // The dashboard's embedded map section is titled "Flood Map" (it mirrors
    // the dedicated /map page). The map canvas itself may not render in
    // headless Chromium without a valid Google Maps key, so we only check
    // the section heading is present.
    await expect(page.getByText(/Flood Map/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('should show live data indicator', async ({ page }) => {
    await expect(
      page.getByText(/Live|Updated|Paused/i).first()
    ).toBeVisible({ timeout: 20000 });
  });
});
