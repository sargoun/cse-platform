import { expect, test } from '@playwright/test';

/**
 * PR 0 acceptance (1) — a clean clone serves `/healthz` 200.
 *
 * The probe exists so a deployment can be told apart from a deployment that
 * merely responds, and it is deliberately the only route in PR 0: everything
 * else waits for the tables and the auth that PR 3 and PR 6 bring.
 */
test('/healthz antwortet 200 und nennt Build und Region', async ({ request }) => {
  const antwort = await request.get('/healthz');
  expect(antwort.status()).toBe(200);

  const koerper = (await antwort.json()) as {
    status: string;
    build_id: string;
    region: string;
  };
  expect(koerper.status).toBe('ok');
  expect(koerper.build_id).toBeTruthy();
  // D-04: functions run in Frankfurt.
  expect(koerper.region).toBe('fra1');
});
