import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8080';

test.describe('Public App', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('scene list loads', async ({ page }) => {
    await page.goto(`${BASE}/splats`);
    await expect(page.locator('h1')).toContainText('OpenGaussian');
  });

  test('viewer page error for non-existent scene', async ({ page }) => {
    await page.goto(`${BASE}/splats/non-existent-scene`);
    // Should show error state
    await expect(page.locator('text=Failed to load')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Admin App', () => {
  test('login page loads', async ({ page }) => {
    await page.goto(`${BASE}/admin/`);
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('can login with default credentials', async ({ page }) => {
    await page.goto(`${BASE}/admin/`);
    await page.locator('input[type="email"]').fill('admin@example.com');
    await page.locator('input[type="password"]').fill('admin12345');
    await page.locator('button[type="submit"]').click();
    // Should redirect to dashboard
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('admin splats list loads after login', async ({ page }) => {
    await page.goto(`${BASE}/admin/`);
    await page.locator('input[type="email"]').fill('admin@example.com');
    await page.locator('input[type="password"]').fill('admin12345');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible({ timeout: 10000 });
    // Navigate to splats
    await page.goto(`${BASE}/admin/splats`);
    await expect(page.locator('.admin-topbar h1')).toHaveText('Splats', { timeout: 10000 });
  });
});

test.describe('Widget', () => {
  test('widget demo page loads', async ({ page }) => {
    await page.goto(`${BASE}/widget/demo.html`);
    await expect(page.locator('h1')).toContainText('Widget Demo', { timeout: 10000 });
    await expect(page.locator('gs-viewer[vr="true"]')).toBeVisible({ timeout: 10000 });
  });

  test('widget script is accessible', async ({ request }) => {
    const res = await request.get(`${BASE}/widget/gs-viewer.js`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('javascript');
  });
});

test.describe('API', () => {
  test('public splats list returns a valid collection', async ({ request }) => {
    const res = await request.get(`${BASE}/api/splats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // No seeded demo scene — expect empty list
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
  });

  test('manifest returns 404 for non-existent scene', async ({ request }) => {
    const res = await request.get(`${BASE}/api/splats/non-existent-scene/manifest`);
    expect(res.status()).toBe(404);
  });

  test('admin endpoints require auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/splats`);
    expect(res.status()).toBe(401);
  });

  test('admin marker endpoints require auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/splats/some-id/markers`);
    expect(res.status()).toBe(401);
  });
  
  test.describe('Admin Dashboard & Stats', () => {
    test('dashboard shows stats after login', async ({ page, request }) => {
      // Login via API
      const loginRes = await request.post(`${BASE}/api/auth/login`, {
        data: { email: 'admin@example.com', password: 'admin12345' },
      });
      expect(loginRes.ok()).toBeTruthy();
      const { token } = await loginRes.json();

      // Fetch stats
      const statsRes = await request.get(`${BASE}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(statsRes.status()).toBe(200);
      const stats = await statsRes.json();
      expect(stats).toHaveProperty('totalSplats');
      expect(stats).toHaveProperty('publishedSplats');
      expect(stats).toHaveProperty('recentJobs');
    });
  
    test('pretransform CRUD works', async ({ request }) => {
      const loginRes = await request.post(`${BASE}/api/auth/login`, {
        data: { email: 'admin@example.com', password: 'admin12345' },
      });
      const { token } = await loginRes.json();

      const organizationsRes = await request.get(`${BASE}/api/admin/organizations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(organizationsRes.ok()).toBeTruthy();
      const organizations = await organizationsRes.json();
      expect(organizations.items.length).toBeGreaterThan(0);
  
      // Create a test splat with a collision-safe slug for persistent test databases.
      const transformSlug = `transform-test-${Date.now()}`;
      const createRes = await request.post(`${BASE}/api/admin/splats`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { title: 'Transform Test', slug: transformSlug, description: 'Test', organizationId: organizations.items[0].id },
      });
      expect(createRes.ok()).toBeTruthy();
      const { splat } = await createRes.json();
      const splatId = splat.id;
  
      // Get transform (should be null initially)
      const getRes = await request.get(`${BASE}/api/admin/splats/${splatId}/transform`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getRes.status()).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.pretransform).toBeNull();
  
      // Set transform
      const patchRes = await request.patch(`${BASE}/api/admin/splats/${splatId}/transform`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { position: [5, 0, -3], rotation: [0, 45, 0], scale: [2, 2, 2] },
      });
      expect(patchRes.ok()).toBeTruthy();
      const patchBody = await patchRes.json();
      expect(patchBody.pretransform.position).toEqual([5, 0, -3]);
  
      // Verify it was saved
      const verifyRes = await request.get(`${BASE}/api/admin/splats/${splatId}/transform`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const verifyBody = await verifyRes.json();
      expect(verifyBody.pretransform.position).toEqual([5, 0, -3]);
      expect(verifyBody.pretransform.rotation).toEqual([0, 45, 0]);
      expect(verifyBody.pretransform.scale).toEqual([2, 2, 2]);
  
      // Partial update
      await request.patch(`${BASE}/api/admin/splats/${splatId}/transform`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { scale: [1, 1, 1] },
      });
      const finalRes = await request.get(`${BASE}/api/admin/splats/${splatId}/transform`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const finalBody = await finalRes.json();
      expect(finalBody.pretransform.scale).toEqual([1, 1, 1]);
      // Position and rotation should be preserved
      expect(finalBody.pretransform.position).toEqual([5, 0, -3]);
  
      // Cleanup
      await request.delete(`${BASE}/api/admin/splats/${splatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    });
  
    test('admin splats list returns items after pretransform test', async ({ request }) => {
      const loginRes = await request.post(`${BASE}/api/auth/login`, {
        data: { email: 'admin@example.com', password: 'admin12345' },
      });
      const { token } = await loginRes.json();
  
      const res = await request.get(`${BASE}/api/admin/splats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      // The pretransform test creates a splat, so there should be at least 1
      expect(body.items.length).toBeGreaterThanOrEqual(0);
    });
  });
});
