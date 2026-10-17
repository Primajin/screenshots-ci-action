/* eslint-disable no-await-in-loop -- screenshots and uploads are intentionally sequential */
/* eslint-disable camelcase -- the GitHub REST API and webhook payload use snake_case */
import {promises as fs} from 'node:fs';
import process from 'node:process';
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as github from '@actions/github';
import {chromium, devices} from 'playwright';
import telegram from './telegram.js';
import {runPreScript} from './pre-script.js';
import {isScrollEnabled, resolveMaxImageHeight, takeScreenshot} from './capture.js';
import {renderComment} from './comment.js';
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

		if (process.env.GITHUB_WORKSPACE) {
			await io.mkdirP(`${process.env.GITHUB_WORKSPACE}/screenshots/`);
		}

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
				await takeScreenshot(desktopPage, {
					pathFor: desktopPath,
					maxImageHeight,
					fullPage: isFullPage,
					type: screenshotType,
					scrollBeforeCapture: isScrollBeforeCapture,
					waitUntil,
					log: console.log,
				});
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

				await takeScreenshot(page, {
					pathFor: mobilePath,
					maxImageHeight,
					fullPage: isFullPage,
					type: screenshotType,
					scrollBeforeCapture: isScrollBeforeCapture,
					waitUntil,
					log: console.log,
				});
				await context.close();
			}

			core.endGroup(); // End start process mobile devices
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

		// eslint-disable-next-line unicorn/no-process-exit -- must exit non-zero immediately
		process.exit(1);
	}
}

// Comment files to PR
async function uploadAndCommnetImage(files) {
	try {
		const {
			repo: {owner, repo},
			payload: {pull_request},
		} = github.context;

		const releaseId = core.getInput('release-id') || '';
		const octokit = github.getOctokit(process.env.GITHUB_TOKEN);

		const ISOTime = new Date().toISOString();

		const uploadedImage = [];
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

		if (uploadedImage.length > 0) {
			try {
				const body = renderComment(uploadedImage, files);

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
	if (files.length === 0) {
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

	// Commnet files to PR
	const {
		repo: {owner, repo},
		payload: {pull_request},
	} = github.context;
	const releaseId = core.getInput('release-id') || '';

	if (
		Boolean(owner)
		&& Boolean(repo)
		&& Boolean(pull_request)
		&& Boolean(releaseId)
		&& process.env.GITHUB_TOKEN
	) {
		await uploadAndCommnetImage(files);
	}
}

await run();
