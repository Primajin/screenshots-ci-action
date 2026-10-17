# Multi-Device Website Screenshots CI

Capture screenshots of any website — desktop **and** dozens of emulated mobile
devices — right inside your GitHub Actions workflow. Save them as build
artifacts, post them straight into a pull-request comment, or send them to a
Telegram chat.

[![Release](https://img.shields.io/github/v/release/Primajin/screenshots-ci-action?sort=semver&label=release)](https://github.com/Primajin/screenshots-ci-action/releases)
[![Action type](https://img.shields.io/badge/action-composite-brightgreen?logo=githubactions&logoColor=white)](action.yml)
[![CI](https://github.com/Primajin/screenshots-ci-action/actions/workflows/ci.yml/badge.svg)](https://github.com/Primajin/screenshots-ci-action/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=nodedotjs&logoColor=white)](package.json)
[![Playwright](https://img.shields.io/badge/playwright-chromium-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **A maintained, modernized fork** of
> [`flameddd/screenshots-ci-action`](https://github.com/flameddd/screenshots-ci-action)
> (last released 2022). If you're weighing the two, here's what this fork brings:
>
> - 🐛 **`full-page: false` actually works.** The original bundles an old
>   Puppeteer 14, which ignored `full-page: false` for emulated mobile devices
>   and captured the whole scrollable page anyway (a single iPad Pro shot came
>   out ~25 000 px tall). This fork runs on **Playwright** (Chromium), so
>   viewport screenshots behave as documented.
> - 🟢 **Current runtime.** A composite action that installs its own
>   dependencies and Chromium on **Node 24**; the original still targets the
>   end-of-life `node16`.
> - 📱 **Up-to-date device list** via Playwright's built-in device descriptors.
> - 🚀 **Actively released** with
>   [release-please](https://github.com/googleapis/release-please) — pin a stable
>   major with `Primajin/screenshots-ci-action@v4`.
>
> The outputs are the same as the original's and the inputs only differ in
> their kebab-case names, so switching is mostly a matter of replacing
> `flameddd/screenshots-ci-action@master` with `Primajin/screenshots-ci-action@v4`
> and renaming the inputs. Since v4 uses Playwright, a few device names and
> `wait-until` values behave differently; see
> [Migrating from v3](#migrating-from-v3).

## Parameters
| Name(type) | required(default) | Description |
| ------------- | ------------- | ------------- |
| `url`(string) | **required**(`""`) | The target website's URL to generate screenshots |
| `devices`(string) | optional(`""`) | Specific mobile devices to generate screenshots. **Use comma(`,`) to separate devices name.** Device name list in below. |
| `no-desktop`(boolean) | optional(`false`) | Set `true` if not require to get desktop viewpoint screenshots. |
| `full-page`(boolean) | optional(`false`) | Set `true`, takes a screenshot of the full scrollable page. |
| `scroll-before-capture`(boolean) | optional(`true`) | Only used when `full-page` is `true`. Scrolls through the whole page before the capture, so lazy-loaded images and scroll-reveal (IntersectionObserver) content are rendered. `false`, `0`, `no` and `off` (any case) switch it off, anything else keeps it on. See [Tall pages](#tall-pages). |
| `max-image-height`(number) | optional(`16000`) | Only used when `full-page` is `true`. Maximum height in **output pixels** (CSS pixels x device scale factor) of one image: `100` to `16000`, default and ceiling `16000`. A taller page produces `-partN` files instead of one file. See [Tall pages](#tall-pages). |
| `no-commit-hash-file-name`(boolean) | optional(`false`) | Set `true`, the filename would not have commit hash. |
| `type`(string) | optional(`jpeg`) | Specify screenshot type, can be either `jpeg` or `png`. |
| `wait-until`(string) | optional(`networkidle`) | When to consider navigation succeeded (Playwright values). <br> - `load`: consider navigation to be finished when the load event is fired.<br> - `domcontentloaded`: consider navigation to be finished when the DOMContentLoaded event is fired.<br> - `networkidle`: consider navigation to be finished when there are no network connections for at least `500` ms.<br> - `commit`: consider navigation to be finished when the network response is received and the document started loading. <br><br> The legacy Puppeteer values `networkidle0` and `networkidle2` are still accepted and both map to `networkidle`. Consider `load` or `domcontentloaded` when the target website has **long polling requests**, since `networkidle` never settles there.|
| `wait-for-selector`(string) | optional(`''`) | Wait for the **selector** to be attached to the DOM (Playwright state `attached`). If the **selector** doesn't appear after the `wait-for-selector-timeout` of waiting, it will take screenshots immediately. <br> See [README.wait-for-selector](README.wait-for-selector.md) for example |
| `wait-for-selector-timeout`(number) | optional(`30000`) | **WaitForSelector Options:** <br> Maximum time to wait in milliseconds. Pass `0` to disable timeout. <br> - `30000` means 30 seconds |
| `wait-for-selector-visible`(boolean) | optional(`false`) | **WaitForSelector Options:** <br> Wait for the selected element to be present in DOM and to be visible (Playwright state `visible`), i.e. to not have `display: none` or `visibility: hidden` CSS properties. |
| `wait-for-selector-hidden`(boolean) | optional(`false`) | **WaitForSelector Options:** <br> Wait for the selected element to not be found in the DOM or to be hidden (Playwright state `hidden`), i.e. have `display: none` or `visibility: hidden` CSS properties. |
| `pre-script-path`(string) | optional(`''`) | Path (relative to the workspace) to a JavaScript module whose default export is an async function receiving `{ browser, context, page, url }`. It runs once before any screenshot, e.g. to log in or dismiss a cookie banner; cookies and localStorage it sets are reused for every screenshot. <br> See [README.pre-script](/README.pre-script.md) for examples |
| `pre-script-timeout`(number) | optional(`30000`) | Maximum time in milliseconds the pre-script may run before the action fails. Defaults to `30000`. |
| `release-id`(string) | optional(`""`) | GitHub Release Id, it's required to upload screenshots to PR comment. see [README.PR](/README.PR.md) for more detail |
| `comment`(boolean) | optional(`true`) | Post the uploaded screenshots to the pull request. `false`, `0`, `no` and `off` (any case) switch it off: the screenshots are still uploaded to the release (needs `release-id`), nothing is posted. See [PR comments](#pr-comments). |
| `comment-layout`(string) | optional(`details`) | How the comment shows the screenshots: `details` (a collapsible section per group), `inline` (a heading per group, images shown directly) or `links` (only a list of links, no embedded images, the lightest). |
| `comment-open`(string) | optional(`none`) | Layout `details` only: which sections start open. `none` (all closed, so the page stays short and does not jump while images load), `first` or `all`. |
| `comment-group-by`(string) | optional(`capture`) | `capture`: one group per desktop size or device, with its parts inside. `all`: a single group with everything. `none`: one group per image. |
| `comment-image-width`(number) | optional(`600`) | Widest display width in CSS pixels. Every `<img>` gets `width` and `height` from the real pixel size (aspect ratio kept, never enlarged), so the page does not reflow when the images load. `0` leaves both attributes out. |
| `comment-image-height`(string) | optional(`auto-ratio`) | `auto-ratio`: put `height` (from the aspect ratio) next to `width` on every image. `none`: put only the `width`. Use `none` if images look squashed in a narrow window, see [PR comments](#pr-comments). |
| `comment-mode`(string) | optional(`update`) | `update`: edit the comment this action posted earlier on the pull request (found by `comment-tag`), so a PR keeps one comment that follows every push. `new`: always post a new comment. |
| `comment-tag`(string) | optional(`screenshots`) | Names the comment for `update` (a hidden `<!-- screenshots-ci-action:<tag> -->` first line). Use a different tag for every call of the action on the same pull request. |
| `comment-headline`(string) | optional(`Screenshots`) | Headline of the comment. |
| `comment-footer`(boolean) | optional(`true`) | A small footer with the commit and a link to the workflow run. `false`, `0`, `no` and `off` switch it off. |

## Envs
| Name(type) | required(default) | Description |
| ------------- | ------------- | ------------- |
| `TELE_CHAT_ID`(string) | optional(`""`) | Integration with **Telegram**. `screenshots-ci-action` will send screenshots to telegram. see [README.Telegram](/README.Telegram.md) for setting detail. |
| `TELE_BOT_TOKEN`(string) | optional(`""`) | Integration with **Telegram**. `screenshots-ci-action` will send screenshots to telegram. see [README.Telegram](/README.Telegram.md) for setting detail. |
| `GITHUB_TOKEN`(string) | optional(`""`) | GitHub Actions token, it's required to upload screenshots to PR comment. See [README.PR](/README.PR.md) for more detail |

## Tall pages

With `full-page: true` the action first scrolls through the page, then captures it.

**Lazy content.** Long pages often look half empty in a full page capture:
lazy-loaded images and scroll-reveal (IntersectionObserver) sections only render
once they have been scrolled into view, and a capture never scrolled. Before a
full page capture the action therefore scrolls through the document in
viewport-sized steps (at most 15 seconds and 150 steps, so infinite-scroll pages
stop), goes back to the top and waits for the page height to settle. Turn this
off with `scroll-before-capture: false` (accepted off values: `false`, `0`, `no`, `off`).

**Parts.** A page whose output height (CSS pixels x device scale factor) is
above `max-image-height` is captured as consecutive parts that together cover the page
exactly, without gaps, overlap, cropping or downscaling. `max-image-height` counts
**output pixels** and is between `100` and `16000` (default and ceiling
`16000`); other values are clamped with a warning, and invalid values fall back
to the default. Why a ceiling at all:

- Chromium documents a 16,384 device pixel texture limit that can bite on some
  platforms and GPUs ([asfand-dev/aktion](https://github.com/asfand-dev/aktion)
  measured a wrap on its runner; it does not reproduce everywhere).
- GitHub's image proxy refuses comment images over 5 MB.
- JPEG cannot be taller than 65,535 pixels.
- One huge bitmap costs a lot of memory.

- **Names:** `-part1`, `-part2`, ... are inserted before the commit hash and the
  extension, for example `iPhone_13-part1-9890851.jpeg`. Pages that fit keep the
  usual single image and name.
- **PR comment:** the parts of one capture are listed together with their total
  size (`part N of M`, and which parts failed to upload), and the images sit
  directly next to each other; see [PR comments](#pr-comments).
- **Size guard (JPEG parts):** a JPEG part above about 4.8 MB is captured again
  with a lower quality (80, 70, 60, 50, 40). A PNG part over 5 MB only logs a
  warning.

**Behaviour change.** Pages taller than `max-image-height` (default `16000` output pixels)
now produce `-partN` files instead of one file. `16000` is the ceiling, so
there is no way to get one huge file: a single image that tall hits the limits
above. Lower `max-image-height` for more, smaller parts.

Note: another way to render everything is to resize the viewport to the height
of the page before the capture (as aktion does). This action does not, because
it changes the layout of everything sized in `vh`.

## PR comments

With `release-id` and a `pull_request` workflow the action uploads every
screenshot to the release and posts them to the pull request (see
[README.PR](/README.PR.md) for the setup). The `comment-*` inputs decide how the
comment looks and whether it is posted at all.

**Default: closed accordions, one comment per tag that is updated in place.**
Each capture (a desktop size, a device, all parts of a tall page) is a
collapsed `<details>` section, so the pull request page stays short and does not
jump while the pictures load. The summary shows the name, the pixel size, the
number of parts and the file size:

```markdown
<!-- screenshots-ci-action:screenshots -->
### Screenshots

<details>
<summary><b>iPhone 13</b> · 1,170 × 20,276 px · 3 parts · 4.2 MB</summary>

- part 1 of 3: https://github.com/.../iPhone_13-part1-9890851.jpeg
...

<img src="https://github.com/.../iPhone_13-part1-9890851.jpeg" alt="iPhone 13, part 1 of 3" width="600" height="8205"><img ...>

</details>

<sub>Commit 9890851 · [workflow run](https://github.com/.../actions/runs/1)</sub>
```

Every image carries `width` and `height`, scaled down to at most
`comment-image-width` CSS pixels (default 600) with the aspect ratio kept, so the
browser reserves the space before the image arrives. The parts of one capture
sit directly next to each other and read as one continuous page (parts that
are shown at 400 pixels or less would sit side by side, so a line break is put
between them).

**Squashed images in narrow windows.** GitHub's CSS caps an image at the width of
the comment column. In a very narrow window (a phone, a split screen) an image
that has both `width` and `height` can then be drawn squashed, because the height
stays fixed while the width shrinks. If you see that, set
`comment-image-height: none`: only the `width` is written, the images keep their
proportions, and the browser can only reserve the height after the image has
loaded, so the page may jump a little again. The default keeps both attributes,
because a page that does not jump is what the accordion is for.

```yaml
# the defaults: closed accordions, one accordion per capture
- uses: Primajin/screenshots-ci-action@v4
  with:
    url: https://www.google.com/
    release-id: 63601424

# the first accordion starts open
- uses: Primajin/screenshots-ci-action@v4
  with:
    url: https://www.google.com/
    release-id: 63601424
    comment-open: first

# everything in a single accordion, or one accordion per image
    comment-group-by: all     # or: none

# images directly under a heading, no accordion (like v3 did)
    comment-layout: inline

# only a list of links, no embedded images: the lightest comment
    comment-layout: links

# no width and height on the images
    comment-image-width: 0
```

**Update in place.** The first line of the comment is a hidden marker,
`<!-- screenshots-ci-action:<comment-tag> -->`. On the next run the action lists the
comments of the pull request (all pages), finds the one that starts with that
marker and was written by `github-actions[bot]`, by the owner of a personal
access token, or by any other bot (the login of a GitHub App cannot be looked up
with its installation token, so its comments are recognised by being a bot's and
carrying the marker), and edits the newest such comment. That way a pull request
keeps one screenshot comment that follows every push. Nothing is found: a new
comment is created. A comment that was deleted in the meantime (404): a new one
is created. Any other failure of the edit (no permission, rate limit, server
error) is logged and nothing is posted, instead of adding a duplicate on every
run. `comment-mode: new` always posts a new comment, as v3 did.

**Several calls, several comments.** Every call of the action on one pull
request that should keep its own comment needs its own `comment-tag` (and
usually a `comment-headline`):

```yaml
- uses: Primajin/screenshots-ci-action@v4
  with:
    url: https://staging.example.com/
    release-id: 63601424
    comment-tag: staging
    comment-headline: Staging
- uses: Primajin/screenshots-ci-action@v4
  with:
    url: https://staging.example.com/pricing
    release-id: 63601424
    comment-tag: pricing
    comment-headline: Pricing page
```

Calls with the **same** tag must not run in parallel (two jobs of a matrix, or two
pushes in a row without a `concurrency` group): both can see no comment yet and
each creates one. Give parallel jobs different tags, or use a `concurrency`
group per pull request.

**Not posting.** `comment: false` still uploads the screenshots to the release
(when `release-id` is set) and logs their URLs, but posts nothing; the files in
`screenshots/` can go to a workflow artifact as before. The upload then also
happens outside pull request events (for example on `push`), which it never did
before, because without a comment there is no pull request to wait for. With a
comment but without `release-id` nothing is uploaded or posted, and the log says
so.

**Footer.** The footer names the commit under review, which is the head commit
of the pull request. The file names of the screenshots end with the short
`GITHUB_SHA` instead, which on `pull_request` events is the merge commit of the
pull request, so the two shas differ.

**Limits and mistakes.** A comment that would exceed GitHub's 65,536 character
limit is posted with the `links` layout and a warning; if even the links are too
long the list is cut with "…and N more". An unknown value for an enum input
(`comment-layout`, `comment-open`, `comment-group-by`, `comment-image-height`,
`comment-mode`), for a switch (`comment`, `comment-footer`: use `true` or `false`)
or an invalid `comment-image-width` is logged as a warning and the default is
used. Characters of `comment-tag` other than letters, digits (of any language),
space, dot, dash and underscore are replaced with `-`, with a warning.

## Output screenshots
There are **3** different way to output files
1. Upload to **Actions Artifacts**
2. Send message to **Telegram** chat
3. Comment in **PR**

More full example in below

## Example 1
About this example:
- screenshot desktop and few specific devices
- Upload screenshots to **Actions Artifacts**

How to create new workflow
1. At the root of your repository, create a directory named `.github/workflows` to store your workflow files.
2. In `.github/workflows`, add a `.yml` or `.yaml` file for your workflow. For example, `.github/workflows/screenshots-workflow.yml`.

More workflow info:
- https://help.github.com/en/actions/configuring-and-managing-workflows/configuring-a-workflow

```yaml
name: screenshots ci actions
on:
  push:
    branches:
    - master # Trigger flow when something pushed to master branch

jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v7
    - name: screenshots-ci-action
      uses: Primajin/screenshots-ci-action@v4
      with:
        url: https://github.com
        devices: iPhone 6,iPhone 6 landscape,Nexus 7,iPad Pro 11,Galaxy S III landscape,iPad Pro 11 landscape
    - uses: actions/upload-artifact@v7 # Uplaod screenshots to Actions Artifacts via actions/upload-artifact@v7
      with:
        path: screenshots
        name: Download-screenshots
```

## Example 2(screenshot iphone 6, without desktop)

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
        url: https://github.com
        devices: iPhone 6,iPhone 6 landscape
        no-desktop: true
    - uses: actions/upload-artifact@v7
      with:
        path: screenshots
        name: Download-screenshots
```

## Example 3 (multi URLs)
- URL 1: https://www.facebook.com/ (desktop)
- URL 2: https://m.facebook.com/   (mobile (iPhone 6))

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
    - name: screenshots-desktop-facebook
      uses: Primajin/screenshots-ci-action@v4
      with:
        url: https://www.facebook.com/
    - uses: actions/upload-artifact@v7
      with:
        path: screenshots
        name: Download-desktop-screenshots # Put URL1 screenshots into Download-desktop-screenshots
    - run: rm ./screenshots/* # Remove URL1 files

    - name: screenshots-mobile-facebook
      uses: Primajin/screenshots-ci-action@v4
      with:
        url: https://m.facebook.com/
        devices: iPhone 6,iPhone 6 landscape
        no-desktop: true
    - uses: actions/upload-artifact@v7
      with:
        path: screenshots
        name: Download-mobile-screenshots # Put URL2 screenshots into Download-desktop-screenshots
```

## More examples (**Vercel**, **Netlify**)
- [**Vercel** Preview Deployment screenhots](/README.Vercel.md)
- [**Netlify** Preview Deployment screenhots](/README.Netlify.md)
- [Integration with **Telegram**](/README.Telegram.md)
- [Post screenshots into **PR comment**](/README.PR.md)
- [Manually dispatch workflow](/README.workflow-dispatch.md)

## Download screenshots (more result example in below)
![img](./asset/download_screenshots_01.jpg)
![img](./asset/download_screenshots_02.jpg)

## Telegram
![img](./asset/telegram4.jpg)

## Desktop: auto-create all of these ratio
- width: 540px, height: 405px
- width: 600px, height: 450px
- width: 720px, height: 540px
- width: 960px, height: 720px
- width: 1140px, height: 640px
- width: 1280px, height: 720px
- width: 1920px, height: 1080px

### Supported mobile devices

The `devices` input accepts any name from
[Playwright's device list](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json)
(`playwright.devices`). Pass the base name for portrait, or append
` landscape` for the landscape orientation (e.g. `iPad Pro 11 landscape`).
Separate several devices with a comma. Names are matched exactly; a name that
only differs in case is accepted. The list is kept current by upgrading
Playwright.

An **unknown device name fails the run** and the error lists close matches
("did you mean ...") together with the link above.

#### Migrating from the Puppeteer based versions (v3 and earlier)

Playwright's list differs from Puppeteer's `KnownDevices`:

| Puppeteer name (removed) | Use instead |
| ------------- | ------------- |
| `iPad` | `iPad (gen 5)`, `iPad (gen 6)`, `iPad (gen 7)` or `iPad (gen 11)` |
| `iPad Pro` | `iPad Pro 11` |
| `iPhone 4`, `iPhone 5` | no equivalent, closest is `iPhone 6` |
| `JioPhone 2` | no equivalent |

Playwright additionally knows many newer devices (iPhone 16/17 family, Pixel
6-10, Galaxy S24, Galaxy Z Fold/Flip, ...) and the `Desktop Chrome`,
`Desktop Edge`, `Desktop Firefox` and `Desktop Safari` profiles. Names that
exist in both lists (for example `iPhone 13`, `Pixel 5`, `Galaxy S III`) keep
working, but their emulated viewport/user agent may differ slightly between
Puppeteer's and Playwright's data.

Other behaviour changes: `wait-until: networkidle0` and `networkidle2` both map
to Playwright's `networkidle` (see the parameter table), and each device is
rendered in its own browser context.

<details>
<summary>Base devices known to Playwright (as of Playwright 1.64; append ` landscape` for the landscape variant)</summary>

`Blackberry PlayBook`
`BlackBerry Z30`
`Galaxy Note 3`
`Galaxy Note II`
`Galaxy S III`
`Galaxy S5`
`Galaxy S8`
`Galaxy S9+`
`Galaxy S24`
`Galaxy A55`
`Galaxy Tab S4`
`Galaxy Tab S9`
`Galaxy Z Fold 6`
`Galaxy Z Fold 6 Cover`
`Galaxy Z Fold 7`
`Galaxy Z Fold 7 Cover`
`Galaxy Z Flip 6`
`Galaxy Z Flip 6 Cover`
`Galaxy Z Flip 7`
`Galaxy Z Flip 7 Cover`
`iPad (gen 5)`
`iPad (gen 6)`
`iPad (gen 7)`
`iPad (gen 11)`
`iPad Mini`
`iPad Pro 11`
`iPhone 6`
`iPhone 6 Plus`
`iPhone 7`
`iPhone 7 Plus`
`iPhone 8`
`iPhone 8 Plus`
`iPhone SE`
`iPhone SE (3rd gen)`
`iPhone X`
`iPhone XR`
`iPhone 11`
`iPhone 11 Pro`
`iPhone 11 Pro Max`
`iPhone 12`
`iPhone 12 Pro`
`iPhone 12 Pro Max`
`iPhone 12 Mini`
`iPhone 13`
`iPhone 13 Pro`
`iPhone 13 Pro Max`
`iPhone 13 Mini`
`iPhone 14`
`iPhone 14 Plus`
`iPhone 14 Pro`
`iPhone 14 Pro Max`
`iPhone 15`
`iPhone 15 Plus`
`iPhone 15 Pro`
`iPhone 15 Pro Max`
`iPhone 16`
`iPhone 16 Plus`
`iPhone 16 Pro`
`iPhone 16 Pro Max`
`iPhone 16e`
`iPhone 17`
`iPhone Air`
`iPhone 17 Pro`
`iPhone 17 Pro Max`
`iPhone 17e`
`Kindle Fire HDX`
`LG Optimus L70`
`Microsoft Lumia 550`
`Microsoft Lumia 950`
`Nexus 10`
`Nexus 4`
`Nexus 5`
`Nexus 5X`
`Nexus 6`
`Nexus 6P`
`Nexus 7`
`Nokia Lumia 520`
`Nokia N9`
`Pixel 2`
`Pixel 2 XL`
`Pixel 3`
`Pixel 4`
`Pixel 4a (5G)`
`Pixel 5`
`Pixel 6`
`Pixel 6 Pro`
`Pixel 6a`
`Pixel 7`
`Pixel 7 Pro`
`Pixel 7a`
`Pixel 8`
`Pixel 8 Pro`
`Pixel 8a`
`Pixel 9`
`Pixel 9 Pro`
`Pixel 9 Pro XL`
`Pixel 10`
`Pixel 10 Pro`
`Pixel 10 Pro XL`
`Moto G4`

</details>

## Migrating from v3

v4 replaces Puppeteer with Playwright. Outputs are the same, but five things
can change in an existing workflow:

1. **Input names are now kebab-case**, matching the GitHub Actions convention.
   The old camelCase names are **not** accepted any more; GitHub only prints an
   `Unexpected input(s)` warning for them and the values are silently ignored,
   so rename them in your workflow. `url`, `devices` and `type` are unchanged.

   | v3 input | v4 input |
   | --- | --- |
   | `noDesktop` | `no-desktop` |
   | `fullPage` | `full-page` |
   | `noCommitHashFileName` | `no-commit-hash-file-name` |
   | `waitUntil` | `wait-until` |
   | `waitForSelector` | `wait-for-selector` |
   | `waitForSelectorHidden` | `wait-for-selector-hidden` |
   | `waitForSelectorVisible` | `wait-for-selector-visible` |
   | `waitForSelectorTimeout` | `wait-for-selector-timeout` |
   | `releaseId` | `release-id` |
   | `preScriptPath` | `pre-script-path` |
   | `preScriptTimeout` | `pre-script-timeout` |

   (`preScriptPath` and `preScriptTimeout` were added after v3; they only
   exist in the kebab-case form in any released version.)
2. **Device names** now come from Playwright's list. `iPad`, `iPad Pro`,
   `iPhone 4`, `iPhone 5` and `JioPhone 2` no longer exist (see the
   [replacement table](#migrating-from-the-puppeteer-based-versions-v3-and-earlier)),
   and an unknown name now **fails the run** with "did you mean" suggestions
   instead of being skipped.
3. **`wait-until`**: `networkidle0` and `networkidle2` are still accepted but
   both map to Playwright's single `networkidle`. The default is now
   `networkidle`. `commit` is new.
4. **Composite action**: the action installs its own dependencies and Chromium
   (`npx playwright install --with-deps chromium`) instead of running a bundled
   `dist/` on the Node runtime. You no longer need a Chrome/puppeteer install
   step (e.g. `mujo-code/puppeteer-headful`) in your workflow, and
   `PUPPETEER_EXECUTABLE_PATH` / `CHROME_BIN` are no longer honoured.

5. **The PR comment is updated in place** (behaviour change). v3 posted a new
   comment with plain `<img>` tags for every push. v4 keeps one comment per
   `comment-tag` and edits it on the next push, with a closed `<details>` section
   per capture. To get close to the v3 comment use `comment-mode: new`,
   `comment-layout: inline`, `comment-image-width: 0` and `comment-footer: false`
   (the headline and the hidden marker line remain, and the headings show a
   readable name instead of the asset name); see
   [PR comments](#pr-comments). Several calls of the action on one pull request
   now need different `comment-tag`s, or they overwrite each other's comment.

Also new: `wait-for-selector-timeout: 0` now really disables the timeout (it used
to fall back to 30 seconds), and `release-id` is a declared input.

## Development

The action is plain ES modules on Node 24 or newer, linted with [xo](https://github.com/xojs/xo)
and tested with [Vitest](https://vitest.dev/).

```bash
npm ci
npm run lint        # xo (npm run lint:fix to auto-fix)
npm test            # unit tests
npm run coverage    # unit tests with coverage
```

## Result examples
### desktop (600x450)
![img](./asset/desktopPage600x450-9890851.png)

### desktop (960x720)
![img](./asset/desktopPage960x720-9890851.png)

### desktop (1140x640)
![img](./asset/desktopPage1140x640-9890851.png)

### desktop (1920x1080)
![img](./asset/desktopPage1920x1080-9890851.png)

### mobile (iPhone_6_landscape)
![img](./asset/iPhone_6_landscape-9890851.png)

### mobile (iPhone_6)
![img](./asset/iPhone_6-9890851.png)

### mobile (Nexus_7)
![img](./asset/Nexus_7-9890851.png)

### mobile (iPhone_6, full-page)
github.com is 27,560 px tall on an iPhone 6 (2x), above the 16,000 px limit of
one image, so the capture is two parts (`iPhone_6-part1-9890851.jpeg` and
`iPhone_6-part2-9890851.jpeg`), shown here side by side (see
[Tall pages](#tall-pages)):

<p align="center">
  <img width="240" align="top" src="asset/iPhone_6-part1-9890851.jpeg" />
  <img width="240" align="top" src="asset/iPhone_6-part2-9890851.jpeg" />
</p>
