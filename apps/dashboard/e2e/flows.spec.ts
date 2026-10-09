/**
 * End-to-end flows through the real dashboard against the local stack (`pnpm dev`):
 * login with TOTP, add an owner, add a unit with owner shares, create a contract and fill the
 * cheque grid, activate it, then change a cheque's status including bounce and replace.
 *
 * The suite runs in English for stable selectors; the same screens are exercised in Arabic by
 * screenshots.spec.ts. Global setup resets the demo staff authenticator and rate limits.
 */
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString().slice(-6);
const owner = {
  nameAr: `مالك تجريبي ${stamp}`,
  nameEn: `Test Owner ${stamp}`,
  phone: `+97150${stamp.padStart(7, '1')}`,
};
const unitNo = `T-${stamp.slice(-4)}`;

async function dismissToast(page: Page) {
  await page.waitForTimeout(300);
}

test('login with TOTP lands on the overview', async ({ page }) => {
  await login(page, 'admin', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Overview/);
  await expect(page.getByText(/Expected this month/i)).toBeVisible();
});

test('add an owner with a phone number', async ({ page }) => {
  await login(page, 'admin', 'en');
  await page.goto('/owners');
  await page.getByRole('button', { name: /New owner/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (Arabic)').fill(owner.nameAr);
  await dialog.getByLabel('Name (English)').fill(owner.nameEn);
  await dialog.getByLabel('Phone (sign-in number)').fill(owner.phone);
  await dialog.getByRole('button', { name: /^Create$/ }).click();
  await expect(page.getByText(/Owner created/)).toBeVisible();
  await page.getByLabel(/Search/).fill(owner.nameEn);
  await expect(page.getByRole('link', { name: new RegExp(owner.nameEn) })).toBeVisible();
});

test('add a unit and assign owners with shares that must total 100%', async ({ page }) => {
  await login(page, 'admin', 'en');
  await page.goto('/buildings');
  await page.locator('a[href^="/buildings/"]').first().click();
  await page.getByRole('button', { name: /Add unit/ }).click();
  const unitDialog = page.getByRole('dialog');
  await unitDialog.getByLabel('Unit no.').fill(unitNo);
  await unitDialog.getByRole('button', { name: /^Create$/ }).click();
  await dismissToast(page);

  const row = page.getByRole('row', { name: new RegExp(unitNo) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Assign owners/ }).click();
  const shares = page.getByRole('dialog');
  const ownerSelect = shares.getByLabel(/^Owner/).first();
  const ownerValue = await ownerSelect
    .locator('option', { hasText: owner.nameEn })
    .getAttribute('value');
  await ownerSelect.selectOption(ownerValue ?? '');
  const percent = shares.getByLabel(/Share %/).first();
  await percent.fill('60');
  // 60% is not 100%: Save stays disabled and the hint explains why.
  await expect(shares.getByText(/add up to 60%/)).toBeVisible();
  await expect(shares.getByRole('button', { name: /^Save$/ })).toBeDisabled();
  await percent.fill('100');
  await expect(shares.getByRole('button', { name: /^Save$/ })).toBeEnabled();
  await shares.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText(/Owners updated/)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(unitNo) })).toContainText(owner.nameEn);
});

test('create a contract, fill the cheque grid, activate it', async ({ page }) => {
  await login(page, 'admin', 'en');
  await page.goto('/contracts/new');
  const building = page.getByLabel(/^Building/);
  await building.selectOption({ index: 1 });
  // Pick the unit created above (vacant, so it is listed without "show all units").
  const unitSelect = page.getByLabel(/^Unit/).first();
  const unitValue = await unitSelect.locator('option', { hasText: unitNo }).getAttribute('value');
  await unitSelect.selectOption(unitValue ?? '');
  await page.getByLabel(/^Tenant/).selectOption({ index: 1 });
  await page.getByLabel(/Annual rent/).fill('85000');
  await page.getByLabel(/Number of cheques|Cheque count/).selectOption('4');

  // The grid starts empty; staff type every amount, cheque number and bank.
  for (let i = 1; i <= 4; i++) {
    await expect(page.getByLabel(`Amount ${i}`)).toHaveValue('');
  }
  await page.getByRole('button', { name: /Fill equal amounts|split equally/i }).click();
  await expect(page.getByLabel('Amount 1')).toHaveValue('21250');
  for (let i = 1; i <= 4; i++) {
    await page.getByLabel(`Cheque no. ${i}`).fill(`${stamp}${i}`);
    await page.getByLabel(`Bank ${i}`).fill('Emirates NBD');
  }
  await expect(page.getByText(/matches the annual rent/i)).toBeVisible();
  await page.getByRole('button', { name: /Save as draft/ }).click();
  await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Draft/).first()).toBeVisible();

  await page.getByRole('button', { name: /Activate contract/ }).click();
  await expect(page.getByText(/Contract is now active/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Activate contract/ })).toHaveCount(0);
});

test('change a cheque status: deposit, bounce with a reason, replace', async ({ page }) => {
  await login(page, 'admin', 'en');
  await page.goto('/cheques');
  await page.getByLabel(/^Status/).selectOption('upcoming');
  await page.locator('a[href^="/cheques/"]').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Cheque/);

  // upcoming -> deposited
  await page.getByRole('button', { name: /Change status/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Mark deposited/ }).click();
  await dialog.getByRole('button', { name: /^Confirm$/ }).click();
  await expect(page.getByText(/Deposited/).first()).toBeVisible();

  // deposited -> bounced (reason required)
  await page.getByRole('button', { name: /Change status/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Mark bounced/ }).click();
  await expect(dialog.getByRole('button', { name: /^Confirm$/ })).toBeDisabled();
  await dialog.getByLabel(/Bounce reason/).fill('Insufficient funds');
  await dialog.getByRole('button', { name: /^Confirm$/ }).click();
  await expect(page.getByText(/Bounced/).first()).toBeVisible();

  // bounced -> replaced (replacement cheque created in the same transaction)
  await page.getByRole('button', { name: /Change status/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Replace with a new cheque/ }).click();
  await dialog.getByLabel(/Due date/).fill('2027-01-15');
  await dialog.getByLabel(/Amount/).fill('21250');
  await dialog.getByLabel(/Cheque no/).fill(`R${stamp}`);
  await dialog.getByLabel(/Bank/).fill('Mashreq');
  await dialog.getByRole('button', { name: /^Confirm$/ }).click();
  await expect(page.getByText(/Replaced by cheque/)).toBeVisible();
});
