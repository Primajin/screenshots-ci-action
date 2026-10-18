/* eslint-disable no-await-in-loop -- screenshots and uploads are intentionally sequential */
/* eslint-disable camelcase -- the GitHub REST API and webhook payload use snake_case */
import {promises as fs} from 'node:fs';
import process from 'node:process';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {chromium, devices} from 'playwright';
import telegram from './telegram.js';
import {runPreScript} from './pre-script.js';
import {isScrollEnabled, resolveMaxImageHeight, takeScreenshot} from './capture.js';
import {buildCommentBody, commentMarker} from './comment.js';
import {resolveCommentOptions} from './comment-options.js';
import {readImageSize} from './image-size.js';
import {publishComment, shouldUpload} from './pr-comment.js';
import {createRunFiles, ensureScreenshotsDir} from './screenshots-dir.js';
import {
	buildContextOptions,
	buildSelectorWaitOptions,
	describeWaitUntil,
	formatInvalidDevicesError,
	mapWaitUntil,
	normalizeScreenshotType,
	resolveDevices,
} from './utils.js';

const DEFAULT_DESKTOP_VIEWPOINT_RATIO = [
	{width: 540, height: 405},
	{width: 600, height: 450},
	{width: 720, height: 540},
	{width: 960, height: 720},
	{width: 1140, height: 640},
	{width: 1280, height: 720},
	{width: 1920, height: 1080},
];

const DEFAULT_TYPE = 'jpeg';
const deviceNames = Object.keys(devices);
const PATH = process.env.GITHUB_WORKSPACE
	? `${process.env.GITHUB_WORKSPACE}/screenshots/`
	: 'screenshots/';

const POST_FIX = process.env.GITHUB_SHA
	? String(process.env.GITHUB_SHA).slice(0, 7)
	: String(Date.now());

const DEFAULT_WAIT_FOR_SELECTOR = '';

let browser;

// The files THIS call wrote. The directory is shared by every call of the action in
// a job, so uploading, commenting and Telegram only look at these.
const runFiles = createRunFiles(PATH);

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

		const url = core.getInput('url');
		const devicesInput = core.getInput('devices');
		const isNoDesktop = core.getInput('no-desktop') === 'true';
		const isFullPage = core.getInput('full-page') === 'true';
		// Only matters for full page captures; on unless explicitly switched off.
		const isScrollBeforeCapture = isScrollEnabled(core.getInput('scroll-before-capture'));
		const maxImage = resolveMaxImageHeight(core.getInput('max-image-height'));
		if (maxImage.warning) {
			console.warn(maxImage.warning);
		}

		const maxImageHeight = maxImage.value;
		const isNoCommitHashFileName
			= core.getInput('no-commit-hash-file-name') === 'true';

		const screenshotType = normalizeScreenshotType(core.getInput('type'), DEFAULT_TYPE);

		// Playwright values plus legacy Puppeteer values (networkidle0/2).
		const waitUntilInput = core.getInput('wait-until');
		const waitUntilResult = mapWaitUntil(waitUntilInput);
		const {value: waitUntil} = waitUntilResult;
		const {warning, notice} = describeWaitUntil(waitUntilInput, waitUntilResult);
		if (warning) {
			console.warn(warning);
		}

		if (notice) {
			console.log(notice);
		}

		const waitForSelector
			= core.getInput('wait-for-selector') || DEFAULT_WAIT_FOR_SELECTOR;

		// Hidden / visible selector options default to false
		const isWaitForSelectorHidden
			= core.getInput('wait-for-selector-hidden').toLowerCase() === 'true';
		const isWaitForSelectorVisible
			= core.getInput('wait-for-selector-visible').toLowerCase() === 'true';
		const waitForSelectorOptions = buildSelectorWaitOptions({
			visible: isWaitForSelectorVisible,
			hidden: isWaitForSelectorHidden,
			timeout: core.getInput('wait-for-selector-timeout'),
		});

		// How the PR comment looks and where it goes (see "PR comments" in the README)
		const {options: commentOptions, warnings: commentWarnings} = resolveCommentOptions(core.getInput);
		for (const message of commentWarnings) {
			console.warn(message);
		}

		core.startGroup('Action config');
		console.log('Input args:', {
			url,
			noDesktop: isNoDesktop,
			devices: devicesInput,
			fullPage: isFullPage,
			scrollBeforeCapture: isScrollBeforeCapture,
			maxImageHeight,
			type: screenshotType,
			waitUntil,
			waitForSelector,
			waitForSelectorOptions,
			comment: commentOptions,
		});
		core.endGroup(); // Action config

		// 2. Verify User config

		if (!url) {
			console.log(['Task done', '- "url" is empty.'].join('\n'));
			return;
		}

		const {valid: includedDevices, invalid: invalidDevices} = resolveDevices(
			devicesInput,
			deviceNames,
		);
		if (invalidDevices.length > 0) {
			throw new Error(formatInvalidDevicesError(invalidDevices));
		}

		if (isNoDesktop && includedDevices.length === 0) {
			console.log(
				[
					'Task done',
					'- No desktop and and devices are selected. You have chose at least one desktop or device.',
				].join('\n'),
			);
			return;
		}

		// 3. Launch Playwright (chromium). The browser is installed by action.yml
		// via `npx playwright install --with-deps chromium`.
		browser = await chromium.launch();

		// Always: also without GITHUB_WORKSPACE (a local run) the parts of a tall page
		// are written with fs.writeFile, which does not create the directory
		await ensureScreenshotsDir(PATH);

		// 3b. Optional pre-script (login, cookie banner, ...). It runs once on a
		// base context; the resulting cookies/localStorage are copied into every
		// desktop and device context below. Capture always starts after the
		// pre-script returned, so startCapture() is a documented no-op.
		let storageState;
		if (process.env.PRE_SCRIPT_PATH) {
			core.startGroup('Pre-script');
			const baseContext = await browser.newContext();
			try {
				const basePage = await baseContext.newPage();
				await runPreScript({
					browser,
					context: baseContext,
					page: basePage,
					url,
				});
				storageState = await baseContext.storageState();
			} finally {
				await baseContext.close().catch(() => {});
				core.endGroup(); // Pre-script
			}

			console.log(
				'Pre-script finished, session state is reused for all screenshots.',
			);
		}

		// 4. Take desktop screenshots

		if (!isNoDesktop) {
			core.startGroup('start process desktop');
			console.log('Processing desktop screenshot');

			const desktopContext = await browser.newContext(
				buildContextOptions(
					{viewport: DEFAULT_DESKTOP_VIEWPOINT_RATIO[0]},
					storageState,
				),
			);
			const desktopPage = await desktopContext.newPage();

			await desktopPage.goto(url, {waitUntil});
			// Wait for page element when config has element selector
			await waitForConfiguredSelector(
				desktopPage,
				waitForSelector,
				waitForSelectorOptions,
			);

			for (const {width, height} of DEFAULT_DESKTOP_VIEWPOINT_RATIO) {
				// Filename with/without post fix commit hash name; a very tall page is
				// split into -part1, -part2, ... inserted before that suffix
				const desktopPath = part =>
					isNoCommitHashFileName
						? `${PATH}desktopPage${width}x${height}${part}.${screenshotType}`
						: `${PATH}desktopPage${width}x${height}${part}-${POST_FIX}.${screenshotType}`;

				await desktopPage.setViewportSize({width, height});
				runFiles.add(await takeScreenshot(desktopPage, {
					pathFor: desktopPath,
					maxImageHeight,
					fullPage: isFullPage,
					type: screenshotType,
					scrollBeforeCapture: isScrollBeforeCapture,
					waitUntil,
					log: console.log,
				}));
			}

			await desktopContext.close();
			core.endGroup(); // End start process desktop
		}

		// 5. Take mobile device screenshots

		if (includedDevices.length > 0) {
			core.startGroup('start process mobile devices');
			console.log('Processing mobile devices screenshot');

			for (const deviceName of includedDevices) {
				// Filename with/without post fix commit hash name
				const mobileBase = `${PATH}${deviceName.replaceAll(' ', '_')}`;
				const mobilePath = part =>
					isNoCommitHashFileName
						? `${mobileBase}${part}.${screenshotType}`
						: `${mobileBase}${part}-${POST_FIX}.${screenshotType}`;

				// Every device gets its own context built from Playwright's descriptor
				// (viewport, deviceScaleFactor, userAgent, isMobile, hasTouch).
				const context = await browser.newContext(
					buildContextOptions(devices[deviceName], storageState),
				);
				const page = await context.newPage();

				await page.goto(url, {waitUntil});
				// Wait for page element when config has element selector
				await waitForConfiguredSelector(
					page,
					waitForSelector,
					waitForSelectorOptions,
				);

				runFiles.add(await takeScreenshot(page, {
					pathFor: mobilePath,
					maxImageHeight,
					fullPage: isFullPage,
					type: screenshotType,
					scrollBeforeCapture: isScrollBeforeCapture,
					waitUntil,
					log: console.log,
				}));
				await context.close();
			}

			core.endGroup(); // End start process mobile devices
		}

		await browser.close();

		// 6. Run screenshot post task
		await postProcesses(commentOptions, runFiles.names());
	} catch (error) {
		console.error(error);
		core.setFailed(error.message);

		if (browser && browser.close) {
			// Cleanup must never mask the original error or skip the exit code.
			await browser.close().catch(() => {});
		}

		// eslint-disable-next-line unicorn/no-process-exit -- must exit non-zero immediately
		process.exit(1);
	}
}

// Where the footer points: the commit under review and this workflow run
function buildFooter(pullRequest) {
	const {GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId} = process.env;
	return {
		sha: pullRequest?.head?.sha ?? process.env.GITHUB_SHA,
		runUrl: server && repository && runId
			? `${server}/${repository}/actions/runs/${runId}`
			: undefined,
	};
}

// Upload the images to the release; resolves to the ones that made it
async function uploadImages(octokit, {owner, repo, releaseId}, files) {
	const ISOTime = new Date().toISOString();
	const uploaded = [];
	for (const fileName of files) {
		try {
			// Upload image file to release page
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
				uploaded.push({
					fileName,
					name: `${ISOTime}-${fileName}`,
					url: result.data.browser_download_url,
					bytes: data.length,
					...readImageSize(data),
				});
			}
		} catch (error) {
			console.error(`Failed to upload: ${fileName}`);
			console.error(error);
		}
	}

	return uploaded;
}

// Upload the images to the release and, unless switched off, post them to the PR
async function uploadAndCommentImages(files, commentOptions) {
	try {
		const {
			repo: {owner, repo},
			payload: {pull_request},
		} = github.context;

		const releaseId = core.getInput('release-id') || '';
		const octokit = github.getOctokit(process.env.GITHUB_TOKEN);

		const uploaded = await uploadImages(octokit, {owner, repo, releaseId}, files);
		if (uploaded.length === 0) {
			return;
		}

		if (!pull_request || !commentOptions.comment) {
			console.log('Comment skipped, uploaded:', uploaded.map(image => image.url));
			return;
		}

		try {
			const renderOptions = {
				...commentOptions,
				footer: commentOptions.footer ? buildFooter(pull_request) : null,
			};
			const {body, warnings} = buildCommentBody(uploaded, files, renderOptions);
			for (const message of warnings) {
				console.warn(message);
			}

			const result = await publishComment(octokit, {
				owner,
				repo,
				issueNumber: pull_request.number,
				body,
				marker: commentMarker(commentOptions.tag),
				mode: commentOptions.mode,
			});
			console.log(`Comment ${result.action}:`, result.id);
		} catch (error) {
			console.error(error);
		}
	} catch (error) {
		console.error(error);
	}
}

// `files` are the names this call wrote, not everything in the directory
async function postProcesses(commentOptions, files) {
	if (files.length === 0) {
		console.warn(`No screenshots were written to ${PATH}; nothing to send or post.`);
		return;
	}

	// Send files to telegram
	if (Boolean(process.env.TELE_CHAT_ID) && Boolean(process.env.TELE_BOT_TOKEN)) {
		await telegram({
			path: PATH,
			files,
			teleChatId: process.env.TELE_CHAT_ID,
			teltBotToken: process.env.TELE_BOT_TOKEN,
		});
	}

	// Upload to the release and comment on the PR. Without a pull request there is
	// nothing to comment on, but `comment: false` still uploads (a push workflow).
	// context.repo throws without GITHUB_REPOSITORY, as in a local run
	const {owner, repo} = process.env.GITHUB_REPOSITORY ? github.context.repo : {};
	const {pull_request} = github.context.payload;
	const releaseId = core.getInput('release-id') || '';

	const decision = shouldUpload({
		owner,
		repo,
		releaseId,
		token: process.env.GITHUB_TOKEN,
		pullRequest: pull_request,
		comment: commentOptions.comment,
	});
	if (decision.notice) {
		console.log(decision.notice);
	}

	if (decision.upload) {
		await uploadAndCommentImages(files, commentOptions);
	}
}

await run();
