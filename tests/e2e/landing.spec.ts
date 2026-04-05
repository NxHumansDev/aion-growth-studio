import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('homepage redirects to /es/', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/es\//);
  });

  test('diagnostico page loads with form', async ({ page }) => {
    await page.goto('/es/diagnostico');
    await expect(page).toHaveTitle(/Diagnóstico|AION/);

    // Form fields exist
    const urlInput = page.locator('#url');
    const emailInput = page.locator('#email');
    const nameInput = page.locator('#name');

    await expect(urlInput).toBeVisible();
    await expect(emailInput).toBeVisible();
    await expect(nameInput).toBeVisible();
  });

  test('form validates email format', async ({ page }) => {
    await page.goto('/es/diagnostico');

    await page.fill('#url', 'example.com');
    await page.fill('#name', 'Test User');
    await page.fill('#email', 'invalidemail');

    await page.click('#btn-step1');

    // Should show error about invalid email
    const error = page.locator('#error-step1');
    await expect(error).toBeVisible();
    await expect(error).toContainText('email');
  });

  test('form rejects empty URL', async ({ page }) => {
    await page.goto('/es/diagnostico');

    await page.fill('#name', 'Test');
    await page.fill('#email', 'test@test.com');
    // Leave URL empty

    await page.click('#btn-step1');

    const error = page.locator('#error-step1');
    await expect(error).toBeVisible();
    await expect(error).toContainText('URL');
  });
});

test.describe('Legal Pages', () => {
  test('privacy page loads', async ({ page }) => {
    await page.goto('/es/legal/privacidad');
    await expect(page).toHaveTitle(/Privacidad|AION/);
    await expect(page.locator('h1')).toContainText('Privacidad');
  });

  test('terms page loads', async ({ page }) => {
    await page.goto('/es/legal/terminos');
    await expect(page).toHaveTitle(/Términos|Terminos|AION/);
    await expect(page.locator('h1')).toContainText('Terminos');
  });

  test('cookies page loads', async ({ page }) => {
    await page.goto('/es/legal/cookies');
    await expect(page).toHaveTitle(/Cookies|AION/);
    await expect(page.locator('h1')).toContainText('Cookies');
  });
});

test.describe('Login Page', () => {
  test('login page loads with magic link and Google OAuth', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Acceder|AION/);

    // Magic link form
    await expect(page.locator('#magic-email')).toBeVisible();
    await expect(page.locator('#magic-btn')).toBeVisible();

    // Google OAuth
    await expect(page.locator('a[href="/api/auth/google"]')).toBeVisible();

    // Password toggle
    await expect(page.locator('#toggle-password')).toBeVisible();
  });

  test('password form shows on toggle', async ({ page }) => {
    await page.goto('/login');

    // Password form hidden by default
    const passwordForm = page.locator('#password-form');
    await expect(passwordForm).not.toBeVisible();

    // Click toggle
    await page.click('#toggle-password');
    await expect(passwordForm).toBeVisible();
  });
});

test.describe('Open Graph', () => {
  test('landing has OG tags', async ({ page }) => {
    await page.goto('/es/diagnostico');

    const ogTitle = page.locator('meta[property="og:title"]');
    const ogDesc = page.locator('meta[property="og:description"]');
    const ogImage = page.locator('meta[property="og:image"]');

    await expect(ogTitle).toHaveAttribute('content', /.+/);
    await expect(ogDesc).toHaveAttribute('content', /.+/);
    await expect(ogImage).toHaveAttribute('content', /.+/);
  });
});
