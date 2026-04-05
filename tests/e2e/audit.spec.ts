import { test, expect } from '@playwright/test';

test.describe('Audit API', () => {
  test('start audit rejects invalid email', async ({ request }) => {
    const res = await request.post('/api/audit/start', {
      data: { url: 'https://example.com', email: 'invalidemail' },
    });
    // 400 (bad email format) or 401 (auth rejects — email is part of auth flow)
    expect([400, 401]).toContain(res.status());
  });

  test('start audit rejects missing URL', async ({ request }) => {
    const res = await request.post('/api/audit/start', {
      data: { email: 'test@test.com' },
    });
    expect(res.status()).toBe(400);
  });

  test('start audit accepts valid request', async ({ request }) => {
    const res = await request.post('/api/audit/start', {
      data: {
        url: 'https://example.com',
        email: 'test@aiongrowth.com',
        name: 'E2E Test',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.audit_id).toBeTruthy();
    expect(body.status).toBe('processing');
  });

  test('validate-url detects reachable site', async ({ request }) => {
    const res = await request.get('/api/validate-url?url=https://google.com');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.reachable).toBe(true);
  });

  test('validate-url detects unreachable site', async ({ request }) => {
    const res = await request.get('/api/validate-url?url=https://thisdomaindoesnotexist12345.com');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.reachable).toBe(false);
  });
});
