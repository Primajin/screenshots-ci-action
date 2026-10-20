// Problems of the page that was captured: uncaught exceptions, errors in the
// console and a selector that was never reached. They are collected per capture,
// shown as a warning in the PR comment and as annotations of the workflow run,
// and never fail the run: a page that broke is exactly when its screenshot is
// most worth having.

const MAX_ANNOTATIONS = 10;

const oneLine = text => String(text ?? '').replaceAll(/\s+/gv, ' ').trim();

// Full Chromium asks every page for /favicon.ico (the headless shell never did)
// and logs a console error when the site has none. That is the browser, not
// the page, so it is no problem of the page.
const FAILED_RESOURCE = /^Failed to load resource/v;

function isFaviconFailure(message) {
	if (!FAILED_RESOURCE.test(message.text())) {
		return false;
	}

	try {
		return new URL(message.location?.()?.url ?? '').pathname.endsWith('/favicon.ico');
	} catch {
		return false;
	}
}

/**
 Collect the problems of the pages of one run.
 @returns {{add: (label: string, text: string) => void, attach: (page: object, label: string) => void, list: () => {label: string, text: string, count: number}[]}} add() records a problem (the same text of the same capture is counted, not repeated); attach() listens to a page's uncaught errors and console errors (not the failed request for /favicon.ico); list() answers the problems in the order they happened.
 */
function createProblemCollector() {
	const problems = [];
	const add = (label, text) => {
		const line = oneLine(text);
		if (line === '') {
			return;
		}

		const known = problems.find(problem => problem.label === label && problem.text === line);
		if (known) {
			known.count++;
		} else {
			problems.push({label, text: line, count: 1});
		}
	};

	return {
		add,
		// Right after the page is created and before it navigates, or the errors of loading are missed
		attach(page, label) {
			page.on('pageerror', error => {
				add(label, `pageerror: ${error?.message ?? error}`);
			});
			page.on('console', message => {
				if (message.type() === 'error' && !isFaviconFailure(message)) {
					add(label, `console: ${message.text()}`);
				}
			});
		},
		list: () => problems.map(problem => ({...problem})),
	};
}

/**
 The note for a problem that happened more than once.
 @param {number} count How often it happened.
 @returns {string} " (3 times)", or nothing for a problem that happened once.
 */
function repeatNote(count) {
	return count > 1 ? ` (${count} times)` : '';
}

/**
 The text of a problem as it is shown, with how often it happened.
 @param {{text: string, count: number}} problem A collected problem.
 @returns {string} The text, with " (3 times)" when it repeated.
 */
function describeProblem({text, count}) {
	return `${text}${repeatNote(count)}`;
}

/**
 Emit the problems as annotations of the workflow run, the first ones only
 (GitHub shows few annotations per step); the rest is in the log.
 @param {{label: string, text: string, count: number}[]} problems The collected problems.
 @param {(text: string, properties: {title: string}) => void} warn Emits an annotation, core.warning.
 @param {(message: string) => void} [log] Where the problems beyond the limit go.
 @returns {void}
 */
function annotateProblems(problems, warn, log = () => {}) {
	for (const [index, problem] of problems.entries()) {
		const text = describeProblem(problem);
		if (index < MAX_ANNOTATIONS) {
			warn(text, {title: `Page problem (${problem.label})`});
		} else {
			log(`Page problem (${problem.label}): ${text}`);
		}
	}
}

export {
	MAX_ANNOTATIONS, annotateProblems, createProblemCollector, describeProblem, repeatNote,
};
