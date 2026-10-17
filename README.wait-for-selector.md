# Waiting for an element before the screenshot

[Back to the README](README.md)

Use `wait-for-selector` when the page renders the interesting part late (a
spinner, a client side route, a lazy widget). The action opens the page, waits
for the selector, then takes the screenshots.

| Input | Default | What it does |
| --- | --- | --- |
| `wait-for-selector` | `''` | CSS selector to wait for. Empty means no waiting beyond `wait-until`. |
| `wait-for-selector-visible` | `false` | Wait until the element is in the DOM **and** visible (no `display: none` or `visibility: hidden`). |
| `wait-for-selector-hidden` | `false` | Wait until the element is gone from the DOM **or** hidden. Use it to wait for a loading spinner to disappear. |
| `wait-for-selector-timeout` | `30000` | Maximum wait in milliseconds. `0` disables the timeout. |

Without `wait-for-selector-visible` or `-hidden` the action waits for the
element to be **attached** to the DOM (Playwright state `attached`). If both
options are set, `visible` wins. The two options and the timeout do nothing
without `wait-for-selector`.

If the selector does not show up in time the error is logged and the
screenshots are taken anyway, so a slow page never fails the run.

The wait happens once per page load: once for the desktop sizes and once for
every device.

## Example

```yaml
name: screenshots ci actions
on:
  push:
    branches:
    - main

jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v7
    - name: screenshots-ci-action
      uses: Primajin/screenshots-ci-action@v4
      with:
        url: https://flameddd.github.io/screenshots-ci-action-test-waitForSelector/
        no-desktop: true
        devices: iPhone 6
        wait-for-selector: '#waitForElement'
        wait-for-selector-timeout: 5000
    - uses: actions/upload-artifact@v7
      with:
        path: screenshots
        name: Download-screenshots
```

(The URL is a small test page of the original project: it shows
`#waitForElement` after a delay.)

Wait for a spinner to go away:

```yaml
      with:
        url: https://example.com/
        wait-for-selector: '#spinner'
        wait-for-selector-hidden: true
```

## See also

- `wait-until` decides when the navigation itself counts as finished, see
  [Inputs](README.md#inputs).
- The CI scenario `pass-wait-for-selector` runs all of these against a fixture
  page, see [README.ci.md](README.ci.md).
