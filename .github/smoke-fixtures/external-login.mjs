// Logs in to the public login demo (demo-only credentials, same fixture as
// Primajin/webapp-console-log-action). The demo is client side only, so this
// proves the pre-script can drive a real external page, not session reuse.
import process from 'node:process';

export default async ({ page, url }) => {
  await page.goto(url);
  await page
    .getByLabel('Username')
    .fill(process.env.DEMO_LOGIN_USERNAME || 'tomsmith');
  await page
    .getByLabel('Password')
    .fill(process.env.DEMO_LOGIN_PASSWORD || 'SuperSecretPassword!');
  await Promise.all([
    page.waitForURL('**/secure'),
    page.getByRole('button', { name: 'Login' }).click(),
  ]);
  await page.getByText('You logged into a secure area!').waitFor();
};
