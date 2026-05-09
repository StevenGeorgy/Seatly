const { test, expect } = require('@playwright/test');
test('customer booking appears', async ({ page }) => {
  const errors = [];
  page.on('console', msg => { if (['error','warning'].includes(msg.type())) errors.push(msg.type() + ': ' + msg.text()); });
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', 'cenaiva.e2e.customer@test.local');
  await page.fill('#login-password', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.goto('http://localhost:5173/bookings', { waitUntil: 'networkidle' });
  const body = await page.locator('body').innerText();
  console.log(JSON.stringify({ url: page.url(), hasRestaurant: body.includes('Cenaiva Reservation Capacity Test'), hasCode: body.includes('C75AEB3C'), bodySnippet: body.slice(0, 1200), errors: errors.slice(0, 8) }, null, 2));
  await page.screenshot({ path: 'tmp-e2e/customer-bookings.png', fullPage: true });
  expect(body).toContain('Cenaiva Reservation Capacity Test');
  expect(body).toContain('C75AEB3C');
});
