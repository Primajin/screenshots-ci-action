export default async ({ page, url }) => {
  await page.goto(new URL('/login', url).href);
  await page.fill('input[name=user]', 'smoke');
  await page.click('button');
  await page.waitForSelector('text=LOGGED IN');
};
