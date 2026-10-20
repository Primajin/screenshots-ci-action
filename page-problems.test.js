import {describe, expect, it} from 'vitest';
import {
	MAX_ANNOTATIONS,
	annotateProblems,
	createProblemCollector,
	describeProblem,
	repeatNote,
} from './page-problems.js';

// A page double that remembers its listeners
function fakePage() {
	const listeners = new Map();
	return {
		on(event, listener) {
			listeners.set(event, [...listeners.get(event) ?? [], listener]);
		},
		emit(event, argument) {
			for (const listener of listeners.get(event) ?? []) {
				listener(argument);
			}
		},
		listenerCount: event => (listeners.get(event) ?? []).length,
	};
}

const consoleMessage = (type, text, url) => ({type: () => type, text: () => text, location: () => ({url})});

describe('createProblemCollector', () => {
	it('starts empty', () => {
		expect(createProblemCollector().list()).toEqual([]);
	});

	it('records uncaught exceptions and console errors of an attached page', () => {
		const collector = createProblemCollector();
		const page = fakePage();
		collector.attach(page, 'Desktop');
		page.emit('pageerror', new Error('boom'));
		page.emit('console', consoleMessage('error', 'Failed to load resource'));
		expect(collector.list()).toEqual([
			{label: 'Desktop', text: 'pageerror: boom', count: 1},
			{label: 'Desktop', text: 'console: Failed to load resource', count: 1},
		]);
	});

	it('ignores the failed request for /favicon.ico, which only full Chromium makes', () => {
		const collector = createProblemCollector();
		const page = fakePage();
		collector.attach(page, 'Desktop');
		const text = 'Failed to load resource: the server responded with a status of 404 (File not found)';
		page.emit('console', consoleMessage('error', text, 'http://localhost:8080/favicon.ico'));
		page.emit('console', consoleMessage('error', text, 'https://example.com/sub/favicon.ico?v=2'));
		expect(collector.list()).toEqual([]);
	});

	it('still reports a failed resource that is not the favicon', () => {
		const collector = createProblemCollector();
		const page = fakePage();
		collector.attach(page, 'Desktop');
		const text = 'Failed to load resource: the server responded with a status of 404 (File not found)';
		page.emit('console', consoleMessage('error', text, 'http://localhost:8080/missing.png'));
		page.emit('console', consoleMessage('error', text, 'http://localhost:8080/favicon.icon'));
		page.emit('console', consoleMessage('error', text, ''));
		expect(collector.list().map(problem => problem.text)).toEqual([`console: ${text}`]);
		expect(collector.list()[0].count).toBe(3);
	});

	it('still reports an error of the page itself, also when it comes from the favicon url', () => {
		const collector = createProblemCollector();
		const page = fakePage();
		collector.attach(page, 'Desktop');
		page.emit('console', consoleMessage('error', 'cart is undefined', 'http://localhost:8080/demo.js'));
		page.emit('console', consoleMessage('error', 'cart is undefined too', 'http://localhost:8080/favicon.ico'));
		expect(collector.list().map(problem => problem.text)).toEqual([
			'console: cart is undefined',
			'console: cart is undefined too',
		]);
	});

	it('ignores every other console type', () => {
		const collector = createProblemCollector();
		const page = fakePage();
		collector.attach(page, 'Desktop');
		for (const type of ['log', 'warning', 'info', 'debug', 'trace']) {
			page.emit('console', consoleMessage(type, 'nothing'));
		}

		expect(collector.list()).toEqual([]);
	});

	it('listens to exactly pageerror and console', () => {
		const page = fakePage();
		createProblemCollector().attach(page, 'x');
		expect(page.listenerCount('pageerror')).toBe(1);
		expect(page.listenerCount('console')).toBe(1);
	});

	it('keeps the problems of several captures apart by their label', () => {
		const collector = createProblemCollector();
		const desktop = fakePage();
		const phone = fakePage();
		collector.attach(desktop, 'Desktop');
		collector.attach(phone, 'iPhone 13');
		desktop.emit('pageerror', new Error('same'));
		phone.emit('pageerror', new Error('same'));
		expect(collector.list().map(problem => problem.label)).toEqual(['Desktop', 'iPhone 13']);
	});

	it('counts the same problem of a capture instead of repeating it', () => {
		const collector = createProblemCollector();
		const page = fakePage();
		collector.attach(page, 'Desktop');
		for (let index = 0; index < 3; index++) {
			page.emit('console', consoleMessage('error', 'Failed to load resource: 404'));
		}

		expect(collector.list()).toEqual([{label: 'Desktop', text: 'console: Failed to load resource: 404', count: 3}]);
	});

	it('records a problem added by hand, such as a selector that was never reached', () => {
		const collector = createProblemCollector();
		collector.add('iPhone 13', 'never reached ".ready"');
		expect(collector.list()).toEqual([{label: 'iPhone 13', text: 'never reached ".ready"', count: 1}]);
	});

	it('puts a message on one line and drops empty ones', () => {
		const collector = createProblemCollector();
		collector.add('x', '  line one\n\n   line   two\t');
		collector.add('x', ' \t ');
		collector.add('x', undefined);
		expect(collector.list()).toEqual([{label: 'x', text: 'line one line two', count: 1}]);
	});

	it('copes with something thrown that is not an Error', () => {
		const collector = createProblemCollector();
		const page = fakePage();
		collector.attach(page, 'x');
		page.emit('pageerror', 'a string');
		page.emit('pageerror', undefined);
		expect(collector.list().map(problem => problem.text)).toEqual(['pageerror: a string', 'pageerror: undefined']);
	});

	it('answers copies, so the list cannot be changed from outside', () => {
		const collector = createProblemCollector();
		collector.add('x', 'a');
		collector.list()[0].count = 99;
		expect(collector.list()[0].count).toBe(1);
	});
});

describe('repeatNote', () => {
	it('is nothing for a problem that happened once and the number of times otherwise', () => {
		expect(repeatNote(1)).toBe('');
		expect(repeatNote(0)).toBe('');
		expect(repeatNote(2)).toBe(' (2 times)');
		expect(repeatNote(40)).toBe(' (40 times)');
	});
});

describe('describeProblem', () => {
	it('adds the number of times for a repeated problem only', () => {
		expect(describeProblem({text: 'a', count: 1})).toBe('a');
		expect(describeProblem({text: 'a', count: 4})).toBe('a (4 times)');
	});
});

describe('annotateProblems', () => {
	const make = count => Array.from({length: count}, (_, index) => ({label: 'Desktop', text: `problem ${index}`, count: 1}));

	it('warns with a title that names the capture', () => {
		const warnings = [];
		annotateProblems([{label: 'iPhone 13', text: 'pageerror: x', count: 2}], (text, properties) => {
			warnings.push([text, properties]);
		});
		expect(warnings).toEqual([['pageerror: x (2 times)', {title: 'Page problem (iPhone 13)'}]]);
	});

	it('emits at most ten annotations and logs the rest', () => {
		const warnings = [];
		const logs = [];
		annotateProblems(make(13), text => {
			warnings.push(text);
		}, message => {
			logs.push(message);
		});
		expect(MAX_ANNOTATIONS).toBe(10);
		expect(warnings).toHaveLength(10);
		expect(logs).toEqual(['Page problem (Desktop): problem 10', 'Page problem (Desktop): problem 11', 'Page problem (Desktop): problem 12']);
	});

	it('does nothing without problems', () => {
		const warnings = [];
		annotateProblems([], text => {
			warnings.push(text);
		});
		expect(warnings).toEqual([]);
	});
});
