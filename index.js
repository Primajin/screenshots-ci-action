/* eslint-disable no-await-in-loop -- screenshots and uploads are intentionally sequential */
/* eslint-disable camelcase -- the GitHub REST API and webhook payload use snake_case */
import {promises as fs} from 'node:fs';
import process from 'node:process';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {chromium, devices} from 'playwright';
import telegram from './telegram.js';
import {runPreScript} from './pre-script.js';
import {
	isScrollEnabled,
	resolveFullPageStrategy,
	resolveMaxImageHeight,
	takeScreenshot,
} from './capture.js';
import {buildCommentBody, captureLabel, commentMarker} from './comment.js';
import {resolveCommentOptions} from './comment-options.js';
import {readImageSize} from './image-size.js';
import {annotateProblems, createProblemCollector} from './page-problems.js';
import {publishComment, shouldUpload} from './pr-comment.js';
import {createRunFiles, ensureScreenshotsDir} from './screenshots-dir.js';
import {createStatusBar, resolveGlyphColor, resolveStatusBarOptions} from './status-bar.js';
import {
	buildContextOptions,
	buildSelectorWaitOptions,
	describeWaitUntil,
	formatInvalidDevicesError,
	mapWaitUntil,
	normalizeScreenshotType,
	parseSizes,
	resolveContextOptions,
	resolveDesktopViewports,
	resolveDevices,
	sizeContextOptions,
	sizeFileBase,
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

// The problems the pages reported (only collected with report-page-problems)
const pageProblems = createProblemCollector();
let areProblemsReported = false;

// The problems so far, as annotations of the run (once, also when a capture failed:
// then the problems are what explains it)
function reportPageProblems() {
	const problems = pageProblems.list();
	if (!areProblemsReported) {
		areProblemsReported = true;
		annotateProblems(problems, core.warning, console.warn);
	}

	return problems;
}

// Wait for the configured selector. A timeout must not break the flow, so the
// error is logged and the screenshot is taken anyway (unchanged behaviour).
// Resolves to true when the wait timed out.
async function waitForConfiguredSelector(page, selector, options) {
	if (!selector) {
		return false;
	}

	try {
		await page.waitForSelector(selector, options);
		return false;
	} catch (error) {
		console.error(error);
		return true;
	}
}

// The sizes input: {customSizes}, or {customSizes: [], sizesError} with the message
// of what is wrong, so that it is reported together with the devices
function readSizes(input) {
	try {
		return {customSizes: parseSizes(input)};
	} catch (error) {
		return {customSizes: [], sizesError: error.message};
	}
}

// 1. Get the user's config: every input, resolved and validated
function readConfig() {
	const maxImage = resolveMaxImageHeight(core.getInput('max-image-height'));
	if (maxImage.warning) {
		console.warn(maxImage.warning);
	}

	// Playwright values plus legacy Puppeteer values (networkidle0/2).
	const waitUntilInput = core.getInput('wait-until');
	const waitUntilResult = mapWaitUntil(waitUntilInput);
	const {warning, notice} = describeWaitUntil(waitUntilInput, waitUntilResult);
	if (warning) {
		console.warn(warning);
	}

	if (notice) {
		console.log(notice);
	}

	// How the PR comment looks and where it goes (see "PR comments" in the README)
	const {options: commentOptions, warnings: commentWarnings} = resolveCommentOptions(core.getInput);
	for (const message of commentWarnings) {
		console.warn(message);
	}

	return {
		url: core.getInput('url'),
		devicesInput: core.getInput('devices'),
		isNoDesktop: core.getInput('no-desktop') === 'true',
		isFullPage: core.getInput('full-page') === 'true',
		// How a full page capture brings the page on screen; an unknown value fails the run here
		fullPageStrategy: resolveFullPageStrategy(core.getInput('full-page-strategy')),
		// Collect what the pages report (errors, a selector never reached) and show it as warnings
		isReportingPageProblems: core.getInput('report-page-problems').toLowerCase() === 'true',
		// A mock phone status bar for mobile captures; a wrong value fails the run here
		statusBar: resolveStatusBarOptions({
			statusBar: core.getInput('status-bar'),
			time: core.getInput('status-bar-time'),
			battery: core.getInput('status-bar-battery'),
			charging: core.getInput('status-bar-charging'),
			theme: core.getInput('status-bar-theme'),
			mode: core.getInput('status-bar-mode'),
		}),
		// Only matters for full page captures; on unless explicitly switched off.
		isScrollBeforeCapture: isScrollEnabled(core.getInput('scroll-before-capture')),
		maxImageHeight: maxImage.value,
		isNoCommitHashFileName: core.getInput('no-commit-hash-file-name') === 'true',
		screenshotType: normalizeScreenshotType(core.getInput('type'), DEFAULT_TYPE),
		waitUntil: waitUntilResult.value,
		waitForSelector: core.getInput('wait-for-selector') || DEFAULT_WAIT_FOR_SELECTOR,
		// Hidden / visible selector options default to false
		waitForSelectorOptions: buildSelectorWaitOptions({
			visible: core.getInput('wait-for-selector-visible').toLowerCase() === 'true',
			hidden: core.getInput('wait-for-selector-hidden').toLowerCase() === 'true',
			timeout: core.getInput('wait-for-selector-timeout'),
		}),
		// Playwright context options for every capture; an invalid value fails the
		// run here, before a browser is started
		contextOverrides: resolveContextOptions(core.getInput('context-options')),
		// Custom sizes (WIDTHxHEIGHT[@SCALE][:mobile]); an invalid entry fails the run
		// in verifyConfig, together with unknown devices
		...readSizes(core.getInput('sizes')),
		commentOptions,
	};
}

function logConfig(config) {
	core.startGroup('Action config');
	console.log('Input args:', {
		url: config.url,
		noDesktop: config.isNoDesktop,
		devices: config.devicesInput,
		sizes: config.customSizes,
		fullPage: config.isFullPage,
		fullPageStrategy: config.fullPageStrategy,
		reportPageProblems: config.isReportingPageProblems,
		scrollBeforeCapture: config.isScrollBeforeCapture,
		maxImageHeight: config.maxImageHeight,
		type: config.screenshotType,
		waitUntil: config.waitUntil,
		waitForSelector: config.waitForSelector,
		waitForSelectorOptions: config.waitForSelectorOptions,
		contextOptions: config.contextOverrides,
		statusBar: config.statusBar,
		comment: config.commentOptions,
	});
	core.endGroup(); // Action config
}

// 3b. Optional pre-script (login, cookie banner, ...). It runs once on a base
// context; the resulting cookies/localStorage are copied into every desktop,
// size and device context. Capture always starts after the pre-script
// returned, so startCapture() is a documented no-op. Resolves to the session
// state, or undefined without a pre-script.
async function runConfiguredPreScript(url) {
	if (!process.env.PRE_SCRIPT_PATH) {
		return undefined;
	}

	let storageState;
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
	return storageState;
}

// The options of takeScreenshot that every capture shares
const screenshotOptions = (config, pathFor, statusBar) => ({
	pathFor,
	statusBar,
	maxImageHeight: config.maxImageHeight,
	fullPage: config.isFullPage,
	strategy: config.fullPageStrategy,
	type: config.screenshotType,
	scrollBeforeCapture: config.isScrollBeforeCapture,
	waitUntil: config.waitUntil,
	log: console.log,
});

// Filename with/without post fix commit hash name; a very tall page is split
// into -part1, -part2, ... inserted before that suffix
const pathForBase = (config, base) => part =>
	config.isNoCommitHashFileName
		? `${PATH}${base}${part}.${config.screenshotType}`
		: `${PATH}${base}${part}-${POST_FIX}.${config.screenshotType}`;

// Right after a page is created, before it navigates, so the errors of loading
// are not missed
function watchPage(page, config, label) {
	if (config.isReportingPageProblems) {
		pageProblems.attach(page, label);
	}
}

// The status bar of the captures of a context: only a capture that emulates a
// mobile device gets one (the context options are what the page is created with)
function buildStatusBar(config, contextOptions, label) {
	const {platform, mode, time, battery} = config.statusBar;
	if (platform === 'none') {
		return undefined;
	}

	if (contextOptions.isMobile !== true) {
		console.log(`status-bar is ignored for ${label}: it is not a mobile capture (isMobile is off).`);
		return undefined;
	}

	console.log(`Status bar for ${label}: ${platform}, ${mode}, ${time}, battery ${battery}%.`);
	const glyphs = resolveGlyphColor(config.statusBar.theme, contextOptions.colorScheme);
	return createStatusBar(browser, {...config.statusBar, glyphs}, contextOptions.deviceScaleFactor ?? 1);
}

// Open the page and wait for the configured selector, if any
async function openPage(page, config, label) {
	await page.goto(config.url, {waitUntil: config.waitUntil});
	// Wait for page element when config has element selector
	const isTimedOut = await waitForConfiguredSelector(
		page,
		config.waitForSelector,
		config.waitForSelectorOptions,
	);
	if (isTimedOut && config.isReportingPageProblems) {
		pageProblems.add(label, `never reached ${config.waitForSelector}`);
	}
}

// 4. Take desktop screenshots: one context, the page is resized for every size
async function captureDesktop(config, storageState) {
	core.startGroup('start process desktop');
	console.log('Processing desktop screenshot');

	// The 7 fixed sizes, or only the viewport of the context-options
	const desktopSizes = resolveDesktopViewports(DEFAULT_DESKTOP_VIEWPOINT_RATIO, config.contextOverrides);
	if (config.contextOverrides.viewport) {
		const {width, height} = config.contextOverrides.viewport;
		console.log(`context-options sets a viewport: capturing only ${width}x${height} instead of the ${DEFAULT_DESKTOP_VIEWPOINT_RATIO.length} desktop sizes.`);
	}

	const desktopContextOptions = buildContextOptions(
		{viewport: desktopSizes[0]},
		storageState,
		config.contextOverrides,
	);
	const desktopContext = await browser.newContext(desktopContextOptions);
	const statusBar = buildStatusBar(config, desktopContextOptions, 'Desktop');
	const desktopPage = await desktopContext.newPage();
	watchPage(desktopPage, config, 'Desktop');
	await openPage(desktopPage, config, 'Desktop');

	for (const {width, height} of desktopSizes) {
		await desktopPage.setViewportSize({width, height});
		const options = screenshotOptions(config, pathForBase(config, `desktopPage${width}x${height}`), statusBar);
		runFiles.add(await takeScreenshot(desktopPage, options));
	}

	await desktopContext.close();
	core.endGroup(); // End start process desktop
}

// A capture in a context of its own: `contextOptions` are the device descriptor
// or the custom size (with the context-options), `base` is the file name
// without part, commit hash and extension.
async function captureInNewContext(config, contextOptions, base) {
	const context = await browser.newContext(contextOptions);
	const page = await context.newPage();
	// The label the capture has in the comment
	const label = captureLabel(base);
	watchPage(page, config, label);
	await openPage(page, config, label);
	const statusBar = buildStatusBar(config, contextOptions, label);
	const options = screenshotOptions(config, pathForBase(config, base), statusBar);
	runFiles.add(await takeScreenshot(page, options));
	await context.close();
}

// 5. Take the custom size screenshots
async function captureCustomSizes(config, storageState) {
	core.startGroup('start process custom sizes');
	console.log('Processing custom sizes screenshot');

	for (const size of config.customSizes) {
		// No device descriptor: Chromium's own user agent unless the size is
		// :mobile. The size wins over the viewport and scale factor of the
		// context-options, everything else of them applies.
		await captureInNewContext(
			config,
			buildContextOptions({}, storageState, {...config.contextOverrides, ...sizeContextOptions(size)}),
			sizeFileBase(size),
		);
	}

	core.endGroup(); // End start process custom sizes
}

// 6. Take mobile device screenshots
async function captureDevices(config, includedDevices, storageState) {
	core.startGroup('start process mobile devices');
	console.log('Processing mobile devices screenshot');

	for (const deviceName of includedDevices) {
		// Every device gets its own context built from Playwright's descriptor
		// (viewport, deviceScaleFactor, userAgent, isMobile, hasTouch); the
		// context-options win over it.
		await captureInNewContext(
			config,
			buildContextOptions(devices[deviceName], storageState, config.contextOverrides),
			deviceName.replaceAll(' ', '_'),
		);
	}

	core.endGroup(); // End start process mobile devices
}

// 2. Verify the config. Resolves to the devices to capture, or undefined when
// there is nothing to do.
function verifyConfig(config) {
	const {valid: includedDevices, invalid: invalidDevices} = resolveDevices(
		config.devicesInput,
		deviceNames,
	);
	// Everything that is wrong with the sizes and the devices is reported at once; an
	// empty url ends the run before the devices are looked at (but not the sizes)
	const errors = [
		config.sizesError,
		config.url && invalidDevices.length > 0 ? formatInvalidDevicesError(invalidDevices) : undefined,
	].filter(Boolean);
	if (errors.length > 0) {
		throw new Error(errors.join('\n\n'));
	}

	if (!config.url) {
		console.log(['Task done', '- "url" is empty.'].join('\n'));
		return undefined;
	}

	if (config.isNoDesktop && includedDevices.length === 0 && config.customSizes.length === 0) {
		console.log(
			[
				'Task done',
				'- No desktop, sizes and devices are selected. You have chose at least one desktop size, custom size or device.',
			].join('\n'),
		);
		return undefined;
	}

	if (!config.isNoDesktop && config.customSizes.length > 0) {
		console.log('sizes is set and no-desktop is not true: the fixed desktop sizes are captured as well. Set no-desktop: true to capture only the custom sizes and the devices.');
	}

	if (config.fullPageStrategy === 'grow-viewport') {
		console.log(config.isFullPage
			? 'full-page-strategy grow-viewport: the viewport is grown to the height of the page for the capture, scroll-before-capture is ignored.'
			: 'full-page-strategy grow-viewport only applies with full-page: true, it is ignored.');
	}

	return includedDevices;
}

async function run() {
	try {
		const config = readConfig();
		logConfig(config);

		const includedDevices = verifyConfig(config);
		if (!includedDevices) {
			return;
		}

		// 3. Launch Playwright (chromium). The browser is installed by action.yml
		// via `npx playwright install --with-deps chromium`.
		browser = await chromium.launch();

		// Always: also without GITHUB_WORKSPACE (a local run) the parts of a tall page
		// are written with fs.writeFile, which does not create the directory
		await ensureScreenshotsDir(PATH);

		const storageState = await runConfiguredPreScript(config.url);

		if (!config.isNoDesktop) {
			await captureDesktop(config, storageState);
		}

		if (config.customSizes.length > 0) {
			await captureCustomSizes(config, storageState);
		}

		if (includedDevices.length > 0) {
			await captureDevices(config, includedDevices, storageState);
		}

		await browser.close();

		// 7. Report what the pages said, then run the screenshot post task. Problems
		// never fail the run.
		await postProcesses(config.commentOptions, runFiles.names(), reportPageProblems());
	} catch (error) {
		console.error(error);
		core.setFailed(error.message);
		// What the pages reported before the capture failed
		reportPageProblems();

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
async function uploadAndCommentImages(files, commentOptions, problems) {
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
				problems,
			};
			// Rendered when the earlier comment is known: a section is merged into
			// its body, everything else is rendered as a whole. It runs again when the
			// edit finds the comment gone, so a message is shown once.
			const shown = new Set();
			const render = previousBody => {
				const {body, warnings, full} = buildCommentBody(uploaded, files, {...renderOptions, previousBody});
				for (const message of new Set(warnings).difference(shown)) {
					shown.add(message);
					console.warn(message);
				}

				if (full) {
					// GitHub would answer 422 and the section would silently never appear
					core.warning(warnings.at(-1), {title: 'Comment is full'});
					return null;
				}

				return body;
			};

			const result = await publishComment(octokit, {
				owner,
				repo,
				issueNumber: pull_request.number,
				render,
				marker: commentMarker(commentOptions.tag),
				mode: commentOptions.mode,
			});
			console.log(result.action === 'skipped' ? 'Comment not posted, the images are uploaded to the release.' : `Comment ${result.action}:`, result.id ?? '');
		} catch (error) {
			console.error(error);
		}
	} catch (error) {
		console.error(error);
	}
}

// `files` are the names this call wrote, not everything in the directory
async function postProcesses(commentOptions, files, problems) {
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
		await uploadAndCommentImages(files, commentOptions, problems);
	}
}

await run();
