# CI: self-testing scenarios

[Back to the README](README.md)

Every pull request runs the action against itself (`uses: ./`) for each option
it offers. One reusable workflow per scenario lives in `.github/workflows`,
named `_pass_<scenario>.yml` (must succeed) or `_fail_<scenario>.yml` (must
fail), and is wired into `ci.yml` as job `pass-<scenario>` / `fail-<scenario>`.
The `All checks green` job aggregates them.

The scenarios run on every pull request, including stacked ones (PRs that do
not target `main`). The `test` job (unit tests and lint) is gated to PRs that
target `main` and to pushes, so on a stacked PR it is skipped.

| Scenario | What it asserts |
| --- | --- |
| `pass-all-defaults` | 7 desktop sizes, jpeg, commit hash in the name, each image has the size from its file name |
| `pass-devices` | iPhone 13 (1170x1992) and iPad Pro 11 landscape (2388x1668) pixel sizes |
| `pass-no-desktop` | only the device file exists and it is viewport sized, not full page |
| `pass-full-page` | `full-page: true` is taller than the viewport, `false` is exactly the viewport |
| `pass-full-page-tall` | the 20276px `?mode=tall` page (full-page) is captured in consecutive parts (3 for an iPad Pro 11 by default, 16 for an iPhone 13 with `max-image-height: 4000`, 13 with `5000`; `99999` is clamped and logged): at most the maximum per part, parts add up to the page, no blank 250px bands, distinct parts, and the 4000px and 5000px captures consist of identical pixel rows (no gap or overlap at a seam). A control with `scroll-before-capture: false` must fail the blank band check, which tests the input parsing end to end |
| `pass-full-page-grow-viewport` | `full-page-strategy: grow-viewport` on `?mode=iframe`, a page with a sandboxed iframe of another site (a solid magenta page on `127.0.0.1:8082`, served by `second-origin-server.js`) 1500px down: the iframe region must be magenta (95%); the parts of a `max-image-height: 1000` capture have identical pixel rows to the single image (no seam) and show the iframe; a scale factor of 2 works. The control with the default `scroll` strategy must leave the region blank, but that is Chromium's behaviour and may differ on another version or platform, so a different result only logs a warning, while an assertion that cannot be evaluated (no file, a broken script) fails the scenario |
| `pass-context-options` | `context-options` end to end, proven by the colours of the `?mode=scheme` page: dark, reduced motion and a scale factor of 2 on a desktop context and on a device (a `viewport` leaves one desktop file of 1600x1200 instead of seven), the unchanged light and mouse colours without the input (control), a 390x844 mobile context with touch, and the session of a pre-script kept next to the options |
| `pass-sizes` | `sizes` end to end: a messy list (whitespace, an empty entry, a duplicate in another case) gives exactly four images of width x scale by height x scale (1440x900, 2880x1800 for `@2`, 1170x2532 for `390x844@3:mobile`, 1200x900 for `@1.5`) with file names that carry the scale and `-mobile` and no `@`, no desktop file with `no-desktop: true`; `:mobile` shows the touch colour of `?mode=scheme` and the same size without it does not; sizes next to the desktop capture and a device with `context-options` (the entry wins over their viewport and scale factor, the dark scheme applies); a tall page at a custom size is sliced into parts |
| `pass-comment-section` | `comment-section` on the PR: four calls with one `comment-tag` and the headline `Component showcase`. Call 1 (desktop light, `comment-open: first`) creates the comment with one open section; call 2 (dark) adds a section after it and leaves the first byte for byte as it was (same comment id, one footer); call 3 (a `390x844@3:mobile` size) adds a third; call 4 (dark again, scale factor 2) replaces only the dark section where it is. Every step asserts the ordered section slugs, the images per section, the untouched sections and (for call 4) that the call uploaded exactly one release asset. The scenario deletes its own comment from an earlier run first, see below |
| `pass-report-page-problems` | `report-page-problems: true` on `?mode=problems` (a console error and a page error while it loads, a `console.log` that is not a problem) with a `wait-for-selector` that times out, captured as a custom size and an iPhone 13: the screenshots are still taken, the comment has the `> [!WARNING]` block "The page reported 6 problems" with the pageerror, the console error and `never reached` of both captures and not the log; the control call without the input has no warning at all |
| `pass-status-bar` | `status-bar` on an iPhone 13 capture of `?mode=app` (1170x1992 without a bar), proven pixel by pixel: iOS strip is 1170x2133 and Android strip 1170x2064, the rows of the bar differ from the baseline and the page below it is the baseline, row for row; overlay keeps 1170x1992 and leaves everything below the bar untouched; `status-bar-theme: auto` with a dark colour scheme draws white glyphs on a dark page; a battery of 20 is red and a charging one green; only mobile captures get a bar (a plain size and the 7 desktop sizes keep their size, a `:mobile` size grows); a tall page in parts has the bar on the first part, which stays within `max-image-height`, and the parts add up to the page plus the bar |
| `pass-per-run-files` | two sequential calls in one job on the PR (comment tags `per-run-first` and `per-run-second`): the directory holds both images, each comment embeds only its own image and the second call uploaded exactly one release asset |
| `pass-type` | png and jpeg: magic bytes and extension agree |
| `pass-no-commit-hash-file-name` | no hash or timestamp suffix (and the control run has one) |
| `pass-wait-until` | `domcontentloaded` works, legacy `networkidle0` is mapped and logged, unknown values fall back |
| `pass-wait-for-selector` | visible, hidden and timeout `0` wait for a late element (the page grows beyond 3000px); a timeout still takes the screenshot |
| `pass-uses-external-url` | a public site (example.com) |
| `pass-release-pr-comment` | upload to the CI pre-release and the PR comment. The default options must give exactly one bot comment with the marker `<!-- screenshots-ci-action:screenshots -->` that uses closed `<details>` (no `<details open`), has `width` and `height` on every `<img>` and the commit; a second call with the same tag must edit that comment (same id, new body, still one comment); a tall page (parts, `part N of M`) with `comment-tag: tall` keeps its own comment, and as GitHub renders it (`body_html`) every part is at least 500 px wide and has no height attribute (GitHub cuts a height above 2000 and shrinks the width with it, which made narrow strips); a `comment-layout: links` call with `comment-tag: links` posts a separate comment without `<img`; `comment: false` uploads but changes none of the scenario's comments (compared by its own tags, as other scenarios write to the PR at the same time). See below |
| `fail-invalid-context-options` | invalid JSON, a value that is not an object, an unknown key and wrong types fail with a message that names the problem, and nothing is captured |
| `fail-invalid-size` | a malformed entry, a width or height out of 1 to 10000, a scale of 0 or above 5 and a device name in `sizes` fail with a message that names every invalid entry and shows `WIDTHxHEIGHT[@SCALE][:mobile]`, and nothing is captured |
| `fail-invalid-status-bar` | a time that does not exist, a battery out of 0 to 100, an unknown platform, theme or mode and a charging that is not true or false fail with a message that names the value, also with `status-bar: none`, and nothing is captured |
| `fail-unknown-device` | the step fails and the message contains `did you mean` |
| `pass-pre-script-login` | a local login server sees the session cookie on every `GET /` (pre-script, desktop and device capture), none anonymous |
| `pass-external-login-pre-script` | a pre-script drives the public login demo (client side only, so no session reuse is asserted) |
| `fail-pre-script-timeout` | a slow pre-script fails the action with `timed out after 1000 ms` |
| `fail-pre-script-error` | a throwing pre-script fails with the `Failed to execute pre-script` prefix |
| `fail-missing-pre-script` | a missing pre-script file fails with the same prefix |

Each scenario uploads its screenshots as a workflow artifact (7 days) and
writes a table (file, format, dimensions, size) to the job summary.

## Add a scenario

1. Copy a small one such as `_pass_type.yml` to `_pass_<name>.yml` (or
   `_fail_<name>.yml` for a run that must fail). It is a reusable workflow
   (`on: workflow_call`) that serves the fixture site, runs `uses: ./` and
   asserts on `screenshots/` with `assert-screenshots.mjs`.
2. Add a job `pass-<name>` to `ci.yml` (same `if:` and `permissions:` as its
   neighbours) and list it under `needs:` of `all-green`.
3. Add a row to the table above.
4. A scenario that posts to the pull request or uploads to the CI release runs
   **at the same time** as the others (they are separate jobs). Give it comment
   tags of its own, assert per tag (`assert-pr-comment.mjs` always does), and never
   compare or count all comments of the PR or the assets of the release: the
   others change them while you look. Compare what is yours (the comments with
   your tags, the assets with the timestamp of your call), and use `>=` on a time
   window for assets.

## Run the action on your machine

The action is a plain Node program, so you can run it without GitHub Actions.
You need Node 24 or newer and a Playwright Chromium:

```shell
npm ci
npx playwright install chromium   # add --with-deps on Linux if system libraries are missing
```

The inputs are environment variables named `INPUT_<NAME>` (upper case, the
dashes stay), which is how GitHub Actions hands them over. `env` can set names
that contain a dash. No other variable is needed:

```shell
env INPUT_URL=https://example.com \
  'INPUT_DEVICES=iPhone 13,iPad Pro 11 landscape' \
  INPUT_NO-DESKTOP=true \
  INPUT_FULL-PAGE=true \
  node index.js
```

The screenshots land in `screenshots/` of the **current directory** (created if
it does not exist; ignored by Git in this repository). Without `GITHUB_SHA` the
file names end with a millisecond timestamp instead of the short commit hash.
Without a `release-id` nothing is uploaded, and without `GITHUB_REPOSITORY` the
GitHub related steps are skipped. To try the fixture site of this repository, serve it the way
the `serve-fixtures` action does and capture
`http://localhost:8080/?mode=tall`:

```shell
python3 -m http.server 8080 --directory .github/smoke-fixtures/site
```

Set `PRE_SCRIPT_PATH` (and `PRE_SCRIPT_TIMEOUT`) to try a pre-script. The unit
tests (`npm test`) need neither a browser nor a network.

## Shared pieces

- `.github/scripts/assert-screenshots.mjs` - dependency free assertions (PNG
  IHDR / JPEG SOF dimensions, counts, height bounds, type, file name rules, blank
  bands, and `--color RRGGBB[@x,y,width,height][:min[-max]]`: the share of the
  pixels of a png, or of a region of it, that have a colour, so a scenario can
  prove that something rendered, or that a colour is absent).
  Unit tested in `assert-screenshots.test.js`.
- `--compare-rows <A> <B> --a-start N --b-start M --rows R --rows-expect same|different`
  of `assert-screenshots.mjs` compares pixel rows of two pngs by their colours (an
  image with an alpha channel equals one without): the status bar scenario uses
  it to show that the rows of the bar differ from the capture without a bar and
  that the page below them is the same, row for row.
- `.github/scripts/assert-pr-comment.mjs` - dependency free assertions on the
  pull request comments (JSON lines from `gh api --jq '... | tojson'`): count of
  bot comments with the marker of a tag, id kept or different, number of
  `<img>`, closed `<details>`, `width`/`height` on every image, required and
  forbidden text, and the sections of a `comment-section` comment (their ordered
  slugs, the text and images of one section, a section left byte for byte
  untouched since an earlier `--write-section`). Unit tested in
  `assert-pr-comment.test.js`.
  `assert-release-assets.sh` (every screenshot is a new release asset) and
  `assert-image-url.sh` (an image URL of the comment is publicly downloadable)
  are small shell helpers next to it.
- `.github/scripts/assert-rendered-html.mjs` - checks how GitHub renders the
  comment (the `body_html` from `gh api -H "Accept: application/vnd.github.full+json"`):
  number of images, a minimum width of every image, no height attribute. Unit
  tested in `assert-rendered-html.test.js`.
- `.github/actions/serve-fixtures` - serves `.github/smoke-fixtures/site` on
  `http://localhost:8080/` and waits until it answers.
- `.github/smoke-fixtures/site` - the "Acme Demo Shop" page every scenario
  captures (`index.html`, `demo.css`, `demo.js`, plain HTML/CSS/JS):
  - The dark header band prints the measured viewport, for example
    `1170 x 1992 px @3x | mobile`, and a badge follows the CSS breakpoints
    (`<600`, `>=600`, `>=960`, `>=1140`, `>=1920`).
  - A ruler on the left edge is labelled every 500px, and the footer prints
    `end of page - document height NNNN px`, so a viewport capture never shows
    the footer while a full-page capture does.
  - `?mode=late` shows a spinner (`#spinner`) for 4000 ms, then a green
    banner and a 3200px high `#late` block (the wait scenarios).
  - `?mode=wait-until` prints the navigation timings (the wait-until scenario).
  - `?mode=tall` is a 20276px document of 40 scroll-reveal sections (blank
    until scrolled into view), each labelled with its y offset and striped in
    its own colour, so every 250px band is unique (the full-page-tall scenario
    and the release scenario).
  - `?mode=scheme` draws three 120px squares at the bottom left of the viewport
    whose colour follows the emulated colour scheme, reduced motion and touch
    pointer: orange / green / grey by default, blue / magenta / yellow with
    `colorScheme: dark`, `reducedMotion: reduce` and a touch device (the
    context-options scenario).
  - `?mode=app` hides the measurement band and the ruler, so the page starts with
    a plain white navigation bar like an app; `?theme=dark` is a dark variant of
    any mode (the status bar scenario and the screenshots of the README, which are
    in `asset/status-bar-ios-light.jpg` and `asset/status-bar-android-dark.jpg`
    and were made with the action itself).
  - `?mode=problems` logs a console error and a console log and throws an
    uncaught error while it loads (the report-page-problems scenario).
  - `?mode=iframe` puts a 600x400 sandboxed iframe of `http://127.0.0.1:8082/`
    (another site than `localhost`, `?iframe=<url>` changes it) at x=64, y=1500 of a
    page that is at least 2200px high (the grow-viewport scenario).
- `.github/smoke-fixtures/second-origin-server.js` - serves one solid magenta
  page on `127.0.0.1:8082`, the "other site" of the iframe scenario. It stops
  by itself after 30 minutes.
- `.github/smoke-fixtures/*.mjs` - the pre-scripts of the pre-script scenarios.
- `.github/smoke-fixtures/login-server.js` - a local login server on port 8081
  that renders the same shop theme (`demo.css`, `demo.js`): a sign-in form, then
  a `Signed in as demo-user` banner on `/` only when the session cookie is sent
  (otherwise a `Signed out` notice). It logs every request with its cookie.

## The CI pre-release

`pass-release-pr-comment` is the only scenario that passes `release-id`, so the
action's own upload path (`uploadReleaseAsset` + PR comment) is exercised for
real. It runs five calls on the PR, with the comment tags `screenshots` (twice,
the second call must edit the first comment), `tall`, `links` and `silent`
(`comment: false`: the screenshots are uploaded, the comments of the PR stay
byte for byte the same), and asserts after each that every tag still has
exactly one comment. The default comment must also carry the real sizes of the
images, `width="600" height="1022"` for the iPhone 13 and `width="600" height="419"`
for the iPad Pro 11 landscape. The release is one
long-lived **pre-release** (never marked latest, tag `ci-screenshots`, no `v`
prefix, so release-please and the major tag job ignore it). Its numeric id
(415059795) is the single `CI_RELEASE_ID` line at the top of
`_pass_release-pr-comment.yml`.

`pass-comment-section` is another scenario that posts to the PR (comment tag
`section-test`, queue `comment-section-<pr>`). Its comment keeps the sections of
every earlier run, so it starts by deleting the comment of that tag written by
`github-actions[bot]` and then rebuilds it call by call; that is the only
deletion in the CI, next to the pruning below.

Assets are named `<ISO timestamp>-<file name>`, so scenarios and re-runs never
collide; they accumulate over time. The scenario only counts assets created
after the call started, and checks that an image URL is publicly downloadable
(ranged GET, `image/*` or `application/octet-stream`). The comment must also
carry the run's short commit sha (in the image URLs) and the head commit (in the
footer). Because comments are edited in place, the comments of the tags above
stay on the PR for its whole life (one comment per tag). The
job queues per pull request (`concurrency` with `cancel-in-progress: false`:
one run executes and one waits; a newer run still replaces an older one that is
waiting, which GitHub then shows as cancelled), because two runs with the same tag
in parallel could each create a comment. It is skipped for
forks and Dependabot (read-only token) and when a PR is closed.

### Pruning

A release holds at most 1000 assets and each run adds about 9. The last step of
the scenario therefore deletes assets of release `415059795` (and only that
release) older than 30 days, judged by the asset `created_at`. It does nothing
while the release has fewer than 600 assets, so normally it is a no-op. Nothing
else in the repository is deleted by CI (except the comment `pass-comment-section` starts from, see above).

Recreate the release if it is ever deleted:

```shell
gh release create ci-screenshots --prerelease --latest=false \
  --title 'CI screenshots' --notes 'Screenshots uploaded by the CI scenarios'
gh api repos/Primajin/screenshots-ci-action/releases/tags/ci-screenshots --jq .id
```

Put the printed id into `CI_RELEASE_ID`.
