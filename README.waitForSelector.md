# waitForSelector example



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

The selector wait uses Playwright states: `attached` by default, `visible` with
`wait-for-selector-visible: true` and `hidden` with `wait-for-selector-hidden: true`
(if both are set, `visible` wins). `wait-for-selector-timeout: 0` disables the
timeout. On a timeout the error is logged and the screenshot is taken anyway.
