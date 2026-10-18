import {Buffer} from 'node:buffer';
import {describe, expect, it} from 'vitest';
import {
	BAR_HEIGHTS,
	DEFAULT_BATTERY,
	DEFAULT_TIME,
	MODES,
	PLATFORMS,
	THEMES,
	applyStatusBar,
	buildStatusBarHtml,
	pngSize,
	resolveGlyphColor,
	resolveStatusBarOptions,
	statusBarHeight,
} from './status-bar.js';

const resolved = (overrides = {}) => ({
	...resolveStatusBarOptions({statusBar: 'ios'}),
	...overrides,
});

describe('resolveStatusBarOptions', () => {
	it('is no status bar with the documented defaults for nothing', () => {
		const expected = {
			platform: 'none', time: '9:41', battery: 100, charging: false, theme: 'auto', mode: 'strip',
		};
		expect(resolveStatusBarOptions()).toEqual(expected);
		expect(resolveStatusBarOptions({})).toEqual(expected);
		expect(resolveStatusBarOptions({
			statusBar: '', time: ' ', battery: '', charging: '', theme: '', mode: '',
		})).toEqual(expected);
		expect(DEFAULT_TIME).toBe('9:41');
		expect(DEFAULT_BATTERY).toBe(100);
	});

	it('accepts the platforms, themes and modes in any case', () => {
		expect(PLATFORMS).toEqual(['none', 'ios', 'android']);
		expect(THEMES).toEqual(['auto', 'light', 'dark']);
		expect(MODES).toEqual(['strip', 'overlay']);
		for (const platform of PLATFORMS) {
			expect(resolveStatusBarOptions({statusBar: platform.toUpperCase()}).platform).toBe(platform);
		}

		for (const theme of THEMES) {
			expect(resolveStatusBarOptions({theme: ` ${theme} `}).theme).toBe(theme);
		}

		for (const mode of MODES) {
			expect(resolveStatusBarOptions({mode}).mode).toBe(mode);
		}
	});

	it('fails for an unknown platform, theme or mode, naming the input and the choices', () => {
		expect(() => resolveStatusBarOptions({statusBar: 'windows'})).toThrow('Unknown status-bar "windows"; use none, ios, android.');
		expect(() => resolveStatusBarOptions({theme: 'blue'})).toThrow('Unknown status-bar-theme "blue"; use auto, light, dark.');
		expect(() => resolveStatusBarOptions({mode: 'float'})).toThrow('Unknown status-bar-mode "float"; use strip, overlay.');
	});

	it('accepts every valid time and normalises a leading zero', () => {
		for (const [input, expected] of [['9:41', '9:41'], ['09:41', '9:41'], ['0:00', '0:00'], ['00:00', '0:00'], ['23:59', '23:59'], ['12:05', '12:05'], [' 7:30 ', '7:30']]) {
			expect(resolveStatusBarOptions({time: input}).time, input).toBe(expected);
		}
	});

	it('fails for a time that is not H:MM or HH:MM from 0:00 to 23:59', () => {
		for (const time of ['24:00', '9:60', '9:5', '941', '9.41', '9:41 AM', '9:41:00', '-1:00', ':41', '9:', 'noon', '123:45', '1:2:3', '09:4', '９:41']) {
			expect(() => resolveStatusBarOptions({time}), time).toThrow(`Invalid status-bar-time "${time.trim()}"; use H:MM or HH:MM from 0:00 to 23:59`);
		}
	});

	it('accepts a battery from 0 to 100', () => {
		for (const [input, expected] of [['0', 0], ['1', 1], ['42', 42], ['100', 100], [' 80 ', 80], ['007', 7]]) {
			expect(resolveStatusBarOptions({battery: input}).battery, input).toBe(expected);
		}
	});

	it('fails for a battery that is not a whole number from 0 to 100', () => {
		for (const battery of ['101', '-1', '50.5', '1e2', 'full', '50%', '0x10', '+5']) {
			expect(() => resolveStatusBarOptions({battery}), battery).toThrow(`Invalid status-bar-battery "${battery}"; use a whole number from 0 to 100.`);
		}
	});

	it('accepts charging as true or false in any case, and fails for anything else', () => {
		expect(resolveStatusBarOptions({charging: 'true'}).charging).toBe(true);
		expect(resolveStatusBarOptions({charging: 'TRUE'}).charging).toBe(true);
		expect(resolveStatusBarOptions({charging: 'false'}).charging).toBe(false);
		for (const charging of ['yes', '1', 'on', 'charging']) {
			expect(() => resolveStatusBarOptions({charging}), charging).toThrow(`Invalid status-bar-charging "${charging}"; use true or false.`);
		}
	});

	it('validates every input even when there is no status bar, so a typo is found early', () => {
		expect(() => resolveStatusBarOptions({statusBar: 'none', time: 'noon'})).toThrow('status-bar-time');
	});
});

describe('statusBarHeight', () => {
	it('is 47 CSS pixels for ios, 24 for android and nothing without a bar', () => {
		expect(statusBarHeight('ios')).toBe(47);
		expect(statusBarHeight('android')).toBe(24);
		expect(statusBarHeight('none')).toBe(0);
		expect(statusBarHeight('windows')).toBe(0);
		expect(BAR_HEIGHTS).toEqual({ios: 47, android: 24});
	});

	it('is whole device pixels at the scale factors of the phones', () => {
		for (const dpr of [2, 3]) {
			expect(statusBarHeight('ios') * dpr).toBe(Math.round(statusBarHeight('ios') * dpr));
		}
	});
});

describe('resolveGlyphColor', () => {
	it('is the colour the theme says', () => {
		expect(resolveGlyphColor('light', 'light')).toBe('light');
		expect(resolveGlyphColor('dark', 'dark')).toBe('dark');
		expect(resolveGlyphColor('light')).toBe('light');
		expect(resolveGlyphColor('dark')).toBe('dark');
	});

	it('follows the emulated colour scheme for auto: dark glyphs on a light page, light glyphs on a dark one', () => {
		expect(resolveGlyphColor('auto', 'dark')).toBe('light');
		expect(resolveGlyphColor('auto', 'light')).toBe('dark');
		expect(resolveGlyphColor('auto', 'no-preference')).toBe('dark');
		expect(resolveGlyphColor('auto')).toBe('dark');
	});
});

describe('buildStatusBarHtml', () => {
	it('is one transparent bar of the width and the platform height, and nothing else', () => {
		const html = buildStatusBarHtml(resolved(), 390, 3);
		expect(html.startsWith('<!doctype html>')).toBe(true);
		expect(html).toContain('background: transparent');
		expect(html).toContain('width: 390px; height: 47px;');
		expect(html).toContain('data-platform="ios"');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('http');
	});

	it('has the clock on the left and signal, wifi and battery on the right, in that order for ios', () => {
		const html = buildStatusBarHtml(resolved(), 390, 3);
		expect(html.indexOf('id="time"')).toBeLessThan(html.indexOf('id="icons"'));
		expect(html).toContain('>9:41</span>');
		const icons = html.slice(html.indexOf('id="icons"'));
		// Signal bars first (four rects), then the wifi arcs, then the battery outline
		expect(icons.indexOf('<rect x="0"')).toBeLessThan(icons.indexOf('<path d="M1.2 4.2'));
		expect(icons.indexOf('<path d="M1.2 4.2')).toBeLessThan(icons.indexOf('width="23" height="11"'));
	});

	it('puts wifi before the signal on android and uses its height and fonts', () => {
		const html = buildStatusBarHtml(resolved({platform: 'android'}), 412, 2.625);
		expect(html).toContain('width: 412px; height: 24px;');
		expect(html).toContain('Roboto');
		expect(html).not.toContain('-apple-system');
		const icons = html.slice(html.indexOf('id="icons"'));
		expect(icons.indexOf('<path d="M1.2 4.2')).toBeLessThan(icons.indexOf('<rect x="0"'));
	});

	it('uses the system fonts of ios and falls back to a plain sans-serif', () => {
		const html = buildStatusBarHtml(resolved(), 390, 3);
		expect(html).toContain('-apple-system');
		expect(html).toContain('sans-serif');
	});

	it('draws four signal bars of rising height', () => {
		const html = buildStatusBarHtml(resolved(), 390, 3);
		const bars = html.match(/<rect x="[\d.]+" y="[\d.]+" width="3" height="[\d.]+" rx="0.8"\/>/gv);
		expect(bars).toHaveLength(4);
		const heights = bars.map(bar => Number(/height="(?<height>[\d.]+)"/v.exec(bar).groups.height));
		expect(heights).toEqual(heights.toSorted((a, b) => a - b));
	});

	it('draws dark glyphs by default and light glyphs on request', () => {
		expect(buildStatusBarHtml(resolved(), 390, 3)).toContain('color: #000000');
		expect(buildStatusBarHtml(resolved({glyphs: 'dark'}), 390, 3)).toContain('color: #000000');
		const light = buildStatusBarHtml(resolved({glyphs: 'light'}), 390, 3);
		expect(light).toContain('color: #ffffff');
		expect(light).not.toContain('color: #000000');
	});

	it('shows the time, escaped', () => {
		const html = buildStatusBarHtml(resolved({time: '<b>"&'}), 390, 3);
		expect(html).toContain('>&lt;b&gt;&quot;&amp;</span>');
		expect(html).not.toContain('<b>');
	});

	it('fills the battery by its level, up to the full inner width of 20', () => {
		const fillWidth = options => {
			const html = buildStatusBarHtml(resolved(options), 390, 3);
			return Number(/<rect x="2" y="2" width="(?<width>[\d.]+)"/v.exec(html).groups.width);
		};

		expect(fillWidth({battery: 100})).toBe(20);
		expect(fillWidth({battery: 50})).toBe(10);
		expect(fillWidth({battery: 25})).toBe(5);
		expect(fillWidth({battery: 1})).toBe(1);
		expect(fillWidth({battery: 0})).toBe(0);
	});

	it('draws the battery red up to 20 percent, green with a bolt while charging, else in the colour of the glyphs', () => {
		const battery = options => buildStatusBarHtml(resolved(options), 390, 3);
		expect(battery({battery: 100})).toContain('height="8" rx="1.8" fill="#000000"');
		expect(battery({battery: 20})).toContain('fill="#ff3b30"');
		expect(battery({battery: 21})).not.toContain('#ff3b30');
		expect(battery({battery: 80, charging: true})).toContain('fill="#30d158"');
		expect(battery({battery: 80, charging: true})).toContain('M12.9 1.8');
		expect(battery({battery: 80})).not.toContain('M12.9 1.8');
		// Charging wins over low
		expect(battery({battery: 5, charging: true})).toContain('#30d158');
		expect(battery({battery: 5, charging: true})).not.toContain('#ff3b30');
	});

	it('makes the outline of the battery one device pixel or more', () => {
		expect(buildStatusBarHtml(resolved(), 390, 3)).toContain('stroke-width="1"');
		expect(buildStatusBarHtml(resolved(), 390, 2.625)).toContain(`stroke-width="${3 / 2.625}"`);
		expect(buildStatusBarHtml(resolved(), 390, 0.5)).toContain('stroke-width="2"');
	});
});

describe('pngSize', () => {
	const png = (width, height) => {
		const buffer = Buffer.alloc(33);
		Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buffer);
		buffer.writeUInt32BE(13, 8);
		buffer.write('IHDR', 12, 'ascii');
		buffer.writeUInt32BE(width, 16);
		buffer.writeUInt32BE(height, 20);
		return buffer;
	};

	it('reads the size from the header', () => {
		expect(pngSize(png(1170, 1992))).toEqual({width: 1170, height: 1992});
	});

	it('fails for something that is not a png', () => {
		expect(() => pngSize(Buffer.from('nope'))).toThrow('Not a PNG image');
		expect(() => pngSize(Buffer.alloc(40))).toThrow('Not a PNG image');
	});
});

describe('applyStatusBar', () => {
	const png = (width, height) => {
		const buffer = Buffer.alloc(33);
		Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buffer);
		buffer.writeUInt32BE(13, 8);
		buffer.write('IHDR', 12, 'ascii');
		buffer.writeUInt32BE(width, 16);
		buffer.writeUInt32BE(height, 20);
		return buffer;
	};

	// A browser double: the composite page answers `result` and the calls are recorded
	const fakeBrowser = result => {
		const calls = [];
		return {
			calls,
			async newContext(options) {
				calls.push(['newContext', options]);
				return {
					async newPage() {
						return {
							async evaluate(_function, argument) {
								calls.push(['evaluate', argument]);
								return result;
							},
						};
					},
					async close() {
						calls.push(['close']);
					},
				};
			},
		};
	};

	const options = {
		...resolveStatusBarOptions({statusBar: 'ios'}),
		glyphs: 'dark',
	};

	it('answers the image the page encoded', async () => {
		const browser = fakeBrowser({data: Buffer.from('ENCODED').toString('base64'), width: 1170, height: 2133});
		const result = await applyStatusBar(browser, png(1170, 1992), options, {type: 'jpeg', quality: 70, barBuffer: png(1170, 141)});
		expect(result.toString()).toBe('ENCODED');
		const argument = browser.calls.find(call => call[0] === 'evaluate')[1];
		expect(argument).toMatchObject({mode: 'strip', type: 'jpeg', quality: 70});
		expect(argument.captureData.startsWith('data:image/png;base64,')).toBe(true);
		expect(browser.calls.at(-1)).toEqual(['close']);
	});

	it('fails with the size when the canvas is too large to encode, instead of writing an empty image', async () => {
		const browser = fakeBrowser({data: '', width: 1170, height: 40_000});
		await expect(applyStatusBar(browser, png(1170, 39_859), options, {type: 'png', barBuffer: png(1170, 141)}))
			.rejects.toThrow('The image is too large to add a status bar (canvas limit): 1170x40000');
		// The throwaway context is closed all the same
		expect(browser.calls.at(-1)).toEqual(['close']);
	});

	it('fails the same way when the page found no canvas context at all', async () => {
		const browser = fakeBrowser({data: '', width: 20_000, height: 20_000});
		await expect(applyStatusBar(browser, png(20_000, 19_859), options, {type: 'jpeg', quality: 80, barBuffer: png(20_000, 141)}))
			.rejects.toThrow('canvas limit): 20000x20000');
	});
});
