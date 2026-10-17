# CI: self-testing scenarios

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
| `pass-full-page` | `fullPage: true` is taller than the viewport, `false` is exactly the viewport |
| `pass-full-page-tall` | the 20276px `?mode=tall` page (fullPage) is captured in consecutive parts (3 for an iPad Pro 11 by default, 16 for an iPhone 13 with `maxImageHeight: 4000`, 13 with `5000`; `99999` is clamped and logged): at most the maximum per part, parts add up to the page, no blank 250px bands, distinct parts, and the 4000px and 5000px captures consist of identical pixel rows (no gap or overlap at a seam). A control with `scrollBeforeCapture: false` must fail the blank band check, which tests the input parsing end to end |
| `pass-type` | png and jpeg: magic bytes and extension agree |
| `pass-no-commit-hash-file-name` | no hash or timestamp suffix (and the control run has one) |
| `pass-wait-until` | `domcontentloaded` works, legacy `networkidle0` is mapped and logged, unknown values fall back |
| `pass-wait-for-selector` | visible, hidden and timeout `0` wait for a late element (the page grows beyond 3000px); a timeout still takes the screenshot |
| `pass-uses-external-url` | a public site (example.com) |
| `pass-release-pr-comment` | upload to the CI pre-release and the PR comment with images, also for a tall page in parts (one comment with `part N of M`), see below |
| `fail-unknown-device` | the step fails and the message contains `did you mean` |
| `pass-pre-script-login` | a local login server sees the session cookie on every `GET /` (pre-script, desktop and device capture), none anonymous |
| `pass-external-login-pre-script` | a pre-script drives the public login demo (client side only, so no session reuse is asserted) |
| `fail-pre-script-timeout` | a slow pre-script fails the action with `timed out after 1000 ms` |
| `fail-pre-script-error` | a throwing pre-script fails with the `Failed to execute pre-script` prefix |
| `fail-missing-pre-script` | a missing pre-script file fails with the same prefix |

Each scenario uploads its screenshots as a workflow artifact (7 days) and
writes a table (file, format, dimensions, size) to the job summary.

## Shared pieces

- `.github/scripts/assert-screenshots.mjs` - dependency free assertions (PNG
  IHDR / JPEG SOF dimensions, counts, height bounds, type, file name rules).
  Unit tested in `assert-screenshots.test.js`.
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
- `.github/smoke-fixtures/*.mjs` - the pre-scripts of the pre-script scenarios.
- `.github/smoke-fixtures/login-server.js` - a local login server on port 8081
  that renders the same shop theme (`demo.css`, `demo.js`): a sign-in form, then
  a `Signed in as demo-user` banner on `/` only when the session cookie is sent
  (otherwise a `Signed out` notice). It logs every request with its cookie.

## The CI pre-release

`pass-release-pr-comment` is the only scenario that passes `releaseId`, so the
action's own upload path (`uploadReleaseAsset` + PR comment) is exercised for
real. Every call posts one PR comment, which is why the other scenarios do not
use it. The release is one long-lived **pre-release** (never marked latest, tag
`ci-screenshots`, no `v` prefix, so release-please and the major tag job ignore
it). Its numeric id (415059795) is the single `CI_RELEASE_ID` line at the top of
`_pass_release-pr-comment.yml`.

Assets are named `<ISO timestamp>-<file name>`, so scenarios and re-runs never
collide; they accumulate over time. The scenario only counts assets and
comments created after it started, and checks that an image URL is publicly
downloadable (ranged GET, `image/*` or `application/octet-stream`). The comment must also carry the run's short commit sha, so it belongs to this run. It is skipped for forks and Dependabot (read-only token) and when
a PR is closed.

### Pruning

A release holds at most 1000 assets and each run adds about 9. The last step of
the scenario therefore deletes assets of release `415059795` (and only that
release) older than 30 days, judged by the asset `created_at`. It does nothing
while the release has fewer than 600 assets, so normally it is a no-op. Nothing
else in the repository is deleted by CI.

Recreate the release if it is ever deleted:

```shell
gh release create ci-screenshots --prerelease --latest=false \
  --title 'CI screenshots' --notes 'Screenshots uploaded by the CI scenarios'
gh api repos/Primajin/screenshots-ci-action/releases/tags/ci-screenshots --jq .id
```

Put the printed id into `CI_RELEASE_ID`.
