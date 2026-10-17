const core = require('@actions/core');
const io = require('@actions/io');
const github = require('@actions/github');
const { chromium, devices } = require('playwright');
const fs = require('fs').promises;
const telegram = require('./telegram.js');
const {
  isScrollEnabled,
  resolveMaxImageHeight,
  takeScreenshot,
} = require('./capture.js');
const { renderCommentBody } = require('./comment.js');
const {
  buildSelectorWaitOptions,
  formatInvalidDevicesError,
  mapWaitUntil,
  resolveDevices,
} = require('./utils.js');

const DEFAULT_DESKTOP_VIEWPOINT_RATIO = [
  { width: 540, height: 405 },
  { width: 600, height: 450 },
  { width: 720, height: 540 },
  { width: 960, height: 720 },
  { width: 1140, height: 640 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

const DEFAULT_TYPE = 'jpeg';
const deviceNames = Object.keys(devices);
const PATH = process.env.GITHUB_WORKSPACE
  ? `${process.env.GITHUB_WORKSPACE}/screenshots/`
  : `screenshots/`;

const POST_FIX = process.env.GITHUB_SHA
  ? `${process.env.GITHUB_SHA}`.substr(0, 7)
  : `${new Date().getTime()}`;

const DEFAULT_WAIT_FOR_SELECTOR = '';

let browser;

// Wait for the configured selector. A timeout must not break the flow, so the
// error is logged and the screenshot is taken anyway (unchanged behaviour).
async function waitForConfiguredSelector(page, selector, options) {
  if (!selector) {
    return;
  }
  try {
    await page.waitForSelector(selector, options);
  } catch (error) {
    console.error(error);
  }
}

async function run() {
  try {
    // 1. Get User config

    const url = core.getInput('url') || '';
    const devicesInput = core.getInput('devices') || '';
    const noDesktop = core.getInput('noDesktop') === 'true';
    const fullPage = core.getInput('fullPage') === 'true';
    // Only matters for full page captures; on unless explicitly switched off.
    const scrollBeforeCapture = isScrollEnabled(
      core.getInput('scrollBeforeCapture')
    );
    const maxImage = resolveMaxImageHeight(core.getInput('maxImageHeight'));
    if (maxImage.warning) {
      console.warn(maxImage.warning);
    }
    const maxImageHeight = maxImage.value;
    const noCommitHashFileName =
      core.getInput('noCommitHashFileName') === 'true';

    let screenshotType = core.getInput('type') || DEFAULT_TYPE;
    screenshotType = screenshotType.toLowerCase();
    if (!['png', 'jpeg'].includes(screenshotType)) {
      screenshotType = DEFAULT_TYPE;
    }

    // Playwright values plus legacy Puppeteer values (networkidle0/2).
    const waitUntilInput = core.getInput('waitUntil');
    const {
      value: waitUntil,
      fallback: waitUntilFallback,
      mappedFrom: waitUntilMappedFrom,
    } = mapWaitUntil(waitUntilInput);
    if (waitUntilFallback) {
      console.warn(
        `Unknown waitUntil "${waitUntilInput}", using "${waitUntil}".`
      );
    }
    if (waitUntilMappedFrom) {
      console.log(
        `waitUntil "${waitUntilMappedFrom}" is a legacy Puppeteer value, using Playwright's "${waitUntil}".`
      );
    }

    const waitForSelector =
      core.getInput('waitForSelector') || DEFAULT_WAIT_FOR_SELECTOR;

    // waitForSelectorHidden / waitForSelectorVisible default false
    const waitForSelectorHidden =
      `${core.getInput('waitForSelectorHidden')}`.toLowerCase() === 'true';
    const waitForSelectorVisible =
      `${core.getInput('waitForSelectorVisible')}`.toLowerCase() === 'true';
    const waitForSelectorOptions = buildSelectorWaitOptions({
      visible: waitForSelectorVisible,
      hidden: waitForSelectorHidden,
      timeout: core.getInput('waitForSelectorTimeout'),
    });

    core.startGroup('Action config');
    console.log('Input args:', {
      url,
      noDesktop: noDesktop,
      devices: devicesInput,
      fullPage,
      scrollBeforeCapture,
      maxImageHeight,
      type: screenshotType,
      waitUntil,
      waitForSelector,
      waitForSelectorOptions,
    });
    core.endGroup(); // Action config

    // 2. Verify User config

    if (!url) {
      console.log([`Task done`, `- "url" is empty.`].join('\n'));
      return;
    }

    const { valid: includedDevices, invalid: invalidDevices } = resolveDevices(
      devicesInput,
      deviceNames
    );
    if (invalidDevices.length) {
      throw new Error(formatInvalidDevicesError(invalidDevices));
    }

    if (noDesktop && !includedDevices.length) {
      console.log(
        [
          `Task done`,
          `- No desktop and and devices are selected. You have chose at least one desktop or device.`,
        ].join('\n')
      );
      return;
    }

    // 3. Launch Playwright (chromium). The browser is installed by action.yml
    // via `npx playwright install --with-deps chromium`.
    browser = await chromium.launch();

    if (process.env.GITHUB_WORKSPACE) {
      await io.mkdirP(`${process.env.GITHUB_WORKSPACE}/screenshots/`);
    }

    // 4. Take desktop screenshots

    if (!noDesktop) {
      core.startGroup('start process desktop');
      console.log('Processing desktop screenshot');

      const desktopContext = await browser.newContext({
        viewport: DEFAULT_DESKTOP_VIEWPOINT_RATIO[0],
      });
      const desktopPage = await desktopContext.newPage();

      await desktopPage.goto(url, { waitUntil });
      // wait for page element when config has element selector
      await waitForConfiguredSelector(
        desktopPage,
        waitForSelector,
        waitForSelectorOptions
      );

      for (const { width, height } of DEFAULT_DESKTOP_VIEWPOINT_RATIO) {
        // filename with/without post fix commit hash name; a very tall page
        // is split into -part1, -part2, ... inserted before that suffix
        const desktopPath = (part) =>
          noCommitHashFileName
            ? `${PATH}desktopPage${width}x${height}${part}.${screenshotType}`
            : `${PATH}desktopPage${width}x${height}${part}-${POST_FIX}.${screenshotType}`;

        await desktopPage.setViewportSize({ width, height });
        await takeScreenshot(desktopPage, {
          pathFor: desktopPath,
          maxImageHeight,
          fullPage,
          type: screenshotType,
          scrollBeforeCapture,
          waitUntil,
          log: console.log,
        });
      }
      await desktopContext.close();
      core.endGroup(); // end start process desktop
    }

    // 5. Take mobile device screenshots

    if (includedDevices.length) {
      core.startGroup('start process mobile devices');
      console.log('Processing mobile devices screenshot');

      for (const deviceName of includedDevices) {
        // filename with/without post fix commit hash name
        const mobileBase = `${PATH}${deviceName.replace(/ /g, '_')}`;
        const mobilePath = (part) =>
          noCommitHashFileName
            ? `${mobileBase}${part}.${screenshotType}`
            : `${mobileBase}${part}-${POST_FIX}.${screenshotType}`;

        // Every device gets its own context built from Playwright's descriptor
        // (viewport, deviceScaleFactor, userAgent, isMobile, hasTouch).
        const context = await browser.newContext({ ...devices[deviceName] });
        const page = await context.newPage();

        await page.goto(url, { waitUntil });
        // wait for page element when config has element selector
        await waitForConfiguredSelector(
          page,
          waitForSelector,
          waitForSelectorOptions
        );

        await takeScreenshot(page, {
          pathFor: mobilePath,
          maxImageHeight,
          fullPage,
          type: screenshotType,
          scrollBeforeCapture,
          waitUntil,
          log: console.log,
        });
        await context.close();
      }
      core.endGroup(); // end start process mobile devices
    }

    await browser.close();

    // 6. Run screenshot post task
    await postProcesses();
  } catch (error) {
    console.error(error);
    core.setFailed(error.message);

    if (browser && browser.close) {
      // Cleanup must never mask the original error or skip the exit code.
      await browser.close().catch(() => {});
    }

    process.exit(1);
  }
}

// Comment files to PR
async function uploadAndCommnetImage(files) {
  try {
    const {
      repo: { owner, repo },
      payload: { pull_request },
    } = github.context;

    const releaseId = core.getInput('releaseId') || '';
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);

    const ISOTime = new Date().toISOString();

    const uploadedImage = [];
    for (const fileName of files) {
      try {
        // upload image file to release page
        const data = await fs.readFile(`${PATH}${fileName}`);
        const result = await octokit.rest.repos.uploadReleaseAsset({
          owner,
          repo,
          release_id: releaseId,
          name: `${ISOTime}-${fileName}`,
          data,
        });
        console.log('uploadReleaseAsset:', result);
        if (result.data.browser_download_url) {
          uploadedImage.push({
            fileName,
            name: `${ISOTime}-${fileName}`,
            url: result.data.browser_download_url,
            bytes: data.length,
          });
        }
      } catch (error) {
        console.error(`Failed to upload: ${fileName}`);
        console.error(error);
      }
    }

    if (uploadedImage.length) {
      try {
        const body = renderCommentBody(uploadedImage, files);

        const result = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: pull_request.number,
          body,
        });
        console.log('createComment:', result);
      } catch (error) {
        console.error(error);
      }
    }
  } catch (error) {
    console.error(error);
  }
}

async function postProcesses() {
  const files = await fs.readdir(PATH);
  if (!files.length) {
    return;
  }

  // Send files to telegram
  if (!!process.env.TELE_CHAT_ID && !!process.env.TELE_BOT_TOKEN) {
    await telegram({
      path: PATH,
      files,
      teleChatId: process.env.TELE_CHAT_ID,
      teltBotToken: process.env.TELE_BOT_TOKEN,
    });
  }

  // Commnet files to PR
  const {
    repo: { owner, repo },
    payload: { pull_request },
  } = github.context;
  const releaseId = core.getInput('releaseId') || '';

  if (
    !!owner &&
    !!repo &&
    !!pull_request &&
    !!releaseId &&
    process.env.GITHUB_TOKEN
  ) {
    await uploadAndCommnetImage(files);
  }
}

run();
