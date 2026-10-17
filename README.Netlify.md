# Screenshots of Netlify preview deployments

[Back to the README](README.md)

When this was written, Netlify did not report deployments through the
[`deployment_status`](https://docs.github.com/en/webhooks/webhook-events-and-payloads#deployment_status)
event (which [Vercel](README.Vercel.md) uses). The workaround below waits for
Netlify's check on the pull request and then asks Netlify for the preview URL,
with two community actions. If your Netlify site does send `deployment_status`
events, the Vercel workflow works the same way.

The screenshots are taken per pull request, and again on every new commit
(Netlify deploys again, the workflow runs again).

## 1. Find the name of the "Pages changed" check

1. Open one of your **pull requests**.
2. Go to the **Checks** tab.
3. Netlify's checks are in the list on the left: copy the name of the
   "**Pages changed** ..." check, for example **"Pages changed - modest-spence-711b92"**.

![The Checks tab of a pull request](https://user-images.githubusercontent.com/22259196/89117111-bf3c3680-d4cd-11ea-8b18-4a9b31040fb6.png)
![The name of the Pages changed check](https://user-images.githubusercontent.com/22259196/89117116-c82d0800-d4cd-11ea-8e09-ffaeb2d3b117.png)

## 2. Find your Netlify site name

Open https://app.netlify.com/ and copy the site name, for example
`modest-spence-711b92`.

![The site name in Netlify](https://user-images.githubusercontent.com/22259196/89117145-20640a00-d4ce-11ea-934a-b9739354c217.png)

## 3. Create `.github/workflows/screenshots.yml`

1. Copy the workflow below.
2. Replace `netlify_PAGE_CHANGED_CHECK_NAME` with your check name. Keep the
   quotes if the name has spaces, for example
   `checkName: 'Pages changed - modest-spence-711b92'`.
3. Replace `netlify_SITE_NAME` with your site name, for example
   `site_name: 'modest-spence-711b92'`.
4. Adjust the `with:` inputs of the screenshots step (the example takes the
   desktop screenshots).

![The workflow in the repository](https://user-images.githubusercontent.com/22259196/89117298-463dde80-d4cf-11ea-9ed1-399be5fda0bd.png)

```yaml
name: Screenshots-ci

on: [pull_request]

permissions:
  contents: read
  checks: read

jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
    - name: Wait for Pages changed to neutral
      uses: fountainhead/action-wait-for-check@v1.2.0
      id: wait-for-Netlify
      with:
        token: ${{ secrets.GITHUB_TOKEN }}
        ref: ${{ github.event.pull_request.head.sha || github.sha }}
        checkName: netlify_PAGE_CHANGED_CHECK_NAME
    - name: Get the preview URL once the Netlify check is done
      if: steps.wait-for-Netlify.outputs.conclusion == 'neutral'
      uses: jakepartusch/wait-for-netlify-action@v1.4
      id: waitFor200
      with:
        site_name: netlify_SITE_NAME
    - uses: actions/checkout@v7
    - name: screenshots-ci-action
      if: steps.wait-for-Netlify.outputs.conclusion == 'neutral'
      uses: Primajin/screenshots-ci-action@v4
      with:
        url: ${{ steps.waitFor200.outputs.url }}
    - uses: actions/upload-artifact@v7
      if: steps.wait-for-Netlify.outputs.conclusion == 'neutral'
      with:
        path: screenshots
        name: Download-screenshots
```

Create a pull request: the workflow starts, waits for Netlify to deploy and
then takes the screenshots. The [PR comment](README.PR.md) works with this
trigger as well, add `release-id` and the `GITHUB_TOKEN` env and the
`contents: write` and `pull-requests: write` permissions (in addition to `checks: read`).

## About the two helper actions

- [`jakepartusch/wait-for-netlify-action`](https://github.com/JakePartusch/wait-for-netlify-action)
  waits for the deploy preview and outputs its URL as
  `${{ steps.waitFor200.outputs.url }}`. It still runs on the Node 16 runtime
  (GitHub prints a deprecation warning) and has an open issue:
  [Does not reliably work when adding a commit to an existing deploy preview](https://github.com/JakePartusch/wait-for-netlify-action/issues/6).
- [`fountainhead/action-wait-for-check`](https://github.com/fountainhead/action-wait-for-check)
  is the workaround for that issue: it waits until Netlify's check for the
  commit has finished, so the preview is current. Once the issue is solved the
  step can be dropped, and the workflow looks like this:

```yaml
name: Successful Deploy Action Example

on: [pull_request]

permissions:
  contents: read

jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
      - name: Waiting for 200 from the Netlify Preview
        uses: jakepartusch/wait-for-netlify-action@v1.4
        id: waitFor200
        with:
          site_name: netlify_SITE_NAME
      - uses: actions/checkout@v7
      - uses: Primajin/screenshots-ci-action@v4
        with:
          url: ${{ steps.waitFor200.outputs.url }}
```

### Why the "Pages changed" check

Netlify adds four checks to a pull request:

- Header rules - modest-spence-...
- Pages changed - modest-spence-...
- Redirect rules - modest-spence-...
- Mixed content - modest-spence-...

"Pages changed" was picked by intuition (the other checks did not seem to do
anything useful here). Its conclusion was `neutral` rather than `success`, which
is why the workflow tests for `'neutral'`. That is an observation, not
something Netlify documents: if your setup is more complicated, another check
may fit better, or the conclusion may become `success`.
