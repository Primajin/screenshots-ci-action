# Pre-script example

Use a pre-script to log in, set a cookie or dismiss a cookie banner **before**
screenshots are taken. The pre-script runs once; the resulting session
(cookies and `localStorage`) is then reused for the desktop screenshots and for
every device, so a login persists across all viewports.

`preScriptPath` points to a JavaScript module (relative to
`GITHUB_WORKSPACE`, so run `actions/checkout` first) whose **default export** is
an async function. It receives:

| Argument | Description |
| --- | --- |
| `browser` | The Playwright `Browser` |
| `context` | The Playwright `BrowserContext` whose state is copied to all screenshots |
| `page` | A fresh Playwright `Page` in that context (not navigated yet) |
| `url` | The `url` input |
| `startCapture` | No-op kept for compatibility with `webapp-console-log-action`. Capture always starts after the pre-script returns. |

If the pre-script throws, or runs longer than `preScriptTimeout`
(default `30000` ms), the action fails with a clear message. Anything you pass
via `env:` (for example secrets) is not logged by the action; avoid printing it
in your script.

Use `.mjs` (or `"type": "module"`) for the script file.

## Login example

`.github/scripts/login.mjs`

```js
export default async ({ page, url }) => {
  await page.goto(new URL('/login', url).href);
  await page.fill('input[name=email]', process.env.APP_USER);
  await page.fill('input[name=password]', process.env.APP_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
};
```

Workflow:

```yaml
name: screenshots ci actions
on:
  push:
    branches:
    - master

jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v7
    - name: screenshots-ci-action
      uses: Primajin/screenshots-ci-action@v4
      env:
        APP_USER: ${{ secrets.APP_USER }}
        APP_PASSWORD: ${{ secrets.APP_PASSWORD }}
      with:
        url: https://example.com/dashboard
        devices: iPhone 13
        preScriptPath: .github/scripts/login.mjs
        preScriptTimeout: 60000
    - uses: actions/upload-artifact@v7
      with:
        path: screenshots
        name: Download-screenshots
```

## Cookie example

```js
export default async ({ context, url }) => {
  await context.addCookies([
    {
      name: 'session',
      value: process.env.SESSION_TOKEN,
      url,
    },
  ]);
};
```

## Dismiss a cookie banner

```js
export default async ({ page, url }) => {
  await page.goto(url);
  await page.click('button:has-text("Accept all")');
};
```

Banners that remember the choice in a cookie or `localStorage` stay dismissed
in all screenshots. State kept only in `sessionStorage` is not carried over.
