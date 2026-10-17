# Screenshots of Vercel preview deployments

[Back to the README](README.md)

Vercel reports every deployment to GitHub, which triggers the
[`deployment_status`](https://docs.github.com/en/webhooks/webhook-events-and-payloads#deployment_status)
event. The workflow below runs when a deployment succeeded and takes screenshots
of its URL (`target_url`).

```yaml
# .github/workflows/screenshots.yml
name: screenshots-ci-action Example
on: deployment_status

permissions:
  contents: read

jobs:
  screenshots:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: screenshots-ci-action
        uses: Primajin/screenshots-ci-action@v4
        with:
          url: ${{ github.event.deployment_status.target_url }}
      - uses: actions/upload-artifact@v7
        with:
          path: screenshots
          name: Download-screenshots
```

Notes:

- The `deployment_status` event carries no pull request, so the
  [PR comment](README.PR.md) of this action cannot be used with this trigger.
  Use the artifact (as above) or [Telegram](README.Telegram.md).
- A preview that is protected by Vercel (deployment protection, password) may
  answer with a login page, and the action would capture that page.
- Add inputs as usual, for example `devices`, `full-page` or
  `wait-for-selector`, see [Inputs](README.md#inputs).
