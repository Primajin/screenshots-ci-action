# Changelog

## [4.0.0](https://github.com/Primajin/screenshots-ci-action/compare/v3.2.0...v4.0.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* the camelCase inputs were renamed and the old names are no longer accepted (GitHub only warns about unexpected inputs): noDesktop -> no-desktop fullPage -> full-page noCommitHashFileName -> no-commit-hash-file-name waitUntil -> wait-until waitForSelector -> wait-for-selector waitForSelectorHidden -> wait-for-selector-hidden waitForSelectorVisible -> wait-for-selector-visible waitForSelectorTimeout -> wait-for-selector-timeout releaseId -> release-id preScriptPath -> pre-script-path preScriptTimeout -> pre-script-timeout
* Puppeteer is replaced by Playwright. Device names come from Playwright's list, so some Puppeteer names no longer exist (iPad, iPad Pro, iPhone 4, iPhone 5, JioPhone 2) and unknown names now fail the run instead of being skipped. waitUntil networkidle0 and networkidle2 collapse into Playwright's single networkidle. The action is now a composite action that installs its own dependencies and Chromium instead of running a bundled dist/ on node24, and the PUPPETEER_EXECUTABLE_PATH / CHROME_BIN overrides are no longer honoured.

### Features

* add pre-script support to run login or setup steps before capturing ([#11](https://github.com/Primajin/screenshots-ci-action/issues/11)) ([d1691a8](https://github.com/Primajin/screenshots-ci-action/commit/d1691a87ef4befaf581b1f66e828284e93f7c32a))
* customise how screenshots are posted to the pull request ([#14](https://github.com/Primajin/screenshots-ci-action/issues/14)) ([d3e3ecc](https://github.com/Primajin/screenshots-ci-action/commit/d3e3eccb793d0d1e3eae41d89a96402d1d37d9aa))
* rename action inputs to kebab-case ([#13](https://github.com/Primajin/screenshots-ci-action/issues/13)) ([1bfea3c](https://github.com/Primajin/screenshots-ci-action/commit/1bfea3c54d282c36aecff9dceac1ba0ff57e3150))
* replace Puppeteer with Playwright and ship as a composite action ([#10](https://github.com/Primajin/screenshots-ci-action/issues/10)) ([ed3882b](https://github.com/Primajin/screenshots-ci-action/commit/ed3882b106293c5ce7e11d96440610e7c6a91935))

## [3.2.0](https://github.com/Primajin/screenshots-ci-action/compare/v3.1.1...v3.2.0) (2026-08-20)


### Features

* run on the Node 24 (latest LTS) runtime ([2e5fa4a](https://github.com/Primajin/screenshots-ci-action/commit/2e5fa4a89adc35d9edabd01354b362cabebb403b))


### Bug Fixes

* resolve system Chrome for puppeteer v24 in CI ([a79a6f2](https://github.com/Primajin/screenshots-ci-action/commit/a79a6f29bcb51798fe35a4e7a979b9d2a7a0847a))

## [3.1.1](https://github.com/Primajin/screenshots-ci-action/compare/v3.1.0...v3.1.1) (2026-08-20)


### Bug Fixes

* shorten Marketplace description under the 125-char limit ([dd818e5](https://github.com/Primajin/screenshots-ci-action/commit/dd818e5ab108346cb6b9935b330faba61b9f3447))

## [3.1.0](https://github.com/Primajin/screenshots-ci-action/compare/v3.0.0...v3.1.0) (2026-08-20)


### Features

* brand the action for the GitHub Marketplace ([5ee6018](https://github.com/Primajin/screenshots-ci-action/commit/5ee6018b356cd0909ea3bbd8831dc47c786e75b8))

## [3.0.0](https://github.com/Primajin/screenshots-ci-action/compare/v2.0.0...v3.0.0) (2026-08-20)


### ⚠ BREAKING CHANGES

* the action now runs on the node20 runtime and requires puppeteer v24 semantics.

### Features

* upgrade to puppeteer v24 on the Node 20 runtime ([46059d9](https://github.com/Primajin/screenshots-ci-action/commit/46059d99c9ee06abc94608b3ae62622ab02e5651))
* waitForSelector feature ([#35](https://github.com/Primajin/screenshots-ci-action/issues/35)) ([cade1d4](https://github.com/Primajin/screenshots-ci-action/commit/cade1d4ef66c9c2948cb29807f981ed0611f3352))
