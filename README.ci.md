# CI: self-testing scenarios

Every pull request runs the action against itself (`uses: ./`) for each option
it offers. One reusable workflow per scenario lives in `.github/workflows`,
named `_pass_<scenario>.yml` (must succeed) or `_fail_<scenario>.yml` (must
fail), and is wired into `ci.yml` as job `pass-<scenario>` / `fail-<scenario>`.
The `All checks green` job aggregates them.

| Scenario | What it asserts |
| --- | --- |
| `pass-all-defaults` | 7 desktop sizes, jpeg, commit hash in the name, each image has the size from its file name |
| `pass-devices` | iPhone 13 (1170x1992) and iPad Pro 11 landscape (2388x1668) pixel sizes |
| `pass-no-desktop` | only the device file exists and it is viewport sized, not full page |
| `pass-full-page` | `fullPage: true` is taller than the viewport, `false` is exactly the viewport |
| `pass-type` | png and jpeg: magic bytes and extension agree |
| `pass-no-commit-hash-file-name` | no hash or timestamp suffix (and the control run has one) |
| `pass-wait-until` | `domcontentloaded` works, legacy `networkidle0` is mapped and logged, unknown values fall back |
| `pass-wait-for-selector` | visible, hidden and timeout `0` wait for a late element (page grows to 3000px); a timeout still takes the screenshot |
| `pass-uses-external-url` | a public site (example.com) |
| `pass-release-pr-comment` | upload to the CI pre-release and the PR comment with images (see below) |
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
- `.github/smoke-fixtures/site` - a tall page and a page that adds `#late`
  after 4 seconds.
- `.github/smoke-fixtures/*.mjs`, `login-server.js` - pre-scripts and the local
  login server for the pre-script scenarios.

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
downloadable. It is skipped for forks and Dependabot (read-only token) and when
a PR is closed.

Recreate the release if it is ever deleted:

```shell
gh release create ci-screenshots --prerelease --latest=false \
  --title 'CI screenshots' --notes 'Screenshots uploaded by the CI scenarios'
gh api repos/Primajin/screenshots-ci-action/releases/tags/ci-screenshots --jq .id
```

Put the printed id into `CI_RELEASE_ID`.
