import { describe, expect, it } from 'vitest';
import {
  buildSelectorWaitOptions,
  findCloseDevices,
  formatInvalidDevicesError,
  mapWaitUntil,
  resolveDevices,
} from './utils.js';

const DEVICES = [
  'iPad Pro 11',
  'iPad Pro 11 landscape',
  'iPhone 13',
  'iPhone 13 landscape',
  'iPhone 13 Pro',
  'Galaxy S III',
  'Pixel 5',
];

describe('mapWaitUntil', () => {
  it('passes Playwright values through', () => {
    for (const value of ['load', 'domcontentloaded', 'networkidle', 'commit']) {
      expect(mapWaitUntil(value)).toEqual({ value, fallback: false });
    }
  });

  it('maps legacy Puppeteer network idle values', () => {
    expect(mapWaitUntil('networkidle0')).toEqual({
      value: 'networkidle',
      fallback: false,
      mappedFrom: 'networkidle0',
    });
    expect(mapWaitUntil('networkidle2').value).toBe('networkidle');
  });

  it('defaults to networkidle when empty and flags unknown values', () => {
    expect(mapWaitUntil('')).toEqual({ value: 'networkidle', fallback: false });
    expect(mapWaitUntil(undefined).value).toBe('networkidle');
    expect(mapWaitUntil('bogus')).toEqual({
      value: 'networkidle',
      fallback: true,
    });
  });

  it('is case/whitespace insensitive', () => {
    expect(mapWaitUntil(' LOAD ').value).toBe('load');
  });
});

describe('findCloseDevices', () => {
  it('finds substring matches case-insensitively', () => {
    expect(findCloseDevices('ipad pro', DEVICES)).toEqual([
      'iPad Pro 11',
      'iPad Pro 11 landscape',
    ]);
  });

  it('finds near-typos', () => {
    expect(findCloseDevices('iPhone13', DEVICES)[0]).toBe('iPhone 13');
    expect(findCloseDevices('Pixle 5', DEVICES)).toContain('Pixel 5');
  });

  it('returns nothing for gibberish or empty input', () => {
    expect(findCloseDevices('zzzzzzzz', DEVICES)).toEqual([]);
    expect(findCloseDevices('', DEVICES)).toEqual([]);
  });

  it('respects the limit', () => {
    expect(findCloseDevices('iphone', DEVICES, 2)).toHaveLength(2);
  });
});

describe('resolveDevices', () => {
  it('accepts exact names and ignores empty entries', () => {
    expect(resolveDevices('iPhone 13, Pixel 5,,', DEVICES)).toEqual({
      valid: ['iPhone 13', 'Pixel 5'],
      invalid: [],
    });
    expect(resolveDevices('', DEVICES)).toEqual({ valid: [], invalid: [] });
  });

  it('normalises case-insensitive exact matches', () => {
    expect(resolveDevices('iphone 13', DEVICES).valid).toEqual(['iPhone 13']);
  });

  it('dedupes repeated devices, including case variants', () => {
    expect(
      resolveDevices('iPhone 13,iPhone 13, iphone 13', DEVICES).valid
    ).toEqual(['iPhone 13']);
  });

  it('treats an ambiguous case-insensitive match as unknown', () => {
    const result = resolveDevices('PIXEL 5', ['Pixel 5', 'pixel 5']);
    expect(result.valid).toEqual([]);
    expect(result.invalid.map(({ name }) => name)).toEqual(['PIXEL 5']);
  });

  it('reports unknown names with suggestions', () => {
    const result = resolveDevices('iPad Pro,iPhone 13', DEVICES);
    expect(result.valid).toEqual(['iPhone 13']);
    expect(result.invalid).toEqual([
      {
        name: 'iPad Pro',
        suggestions: ['iPad Pro 11', 'iPad Pro 11 landscape'],
      },
    ]);
  });
});

describe('formatInvalidDevicesError', () => {
  it('lists suggestions and links to the Playwright device list', () => {
    const message = formatInvalidDevicesError([
      { name: 'iPad Pro', suggestions: ['iPad Pro 11'] },
      { name: 'nope', suggestions: [] },
    ]);
    expect(message).toContain('- "iPad Pro" (did you mean: "iPad Pro 11"?)');
    expect(message).toContain('- "nope"');
    expect(message).toContain('deviceDescriptorsSource.json');
  });
});

describe('buildSelectorWaitOptions', () => {
  it('uses state attached by default', () => {
    expect(buildSelectorWaitOptions({})).toEqual({
      state: 'attached',
      timeout: 30000,
    });
  });

  it('maps visible and hidden', () => {
    expect(buildSelectorWaitOptions({ visible: true }).state).toBe('visible');
    expect(buildSelectorWaitOptions({ hidden: true }).state).toBe('hidden');
    expect(
      buildSelectorWaitOptions({ visible: true, hidden: true }).state
    ).toBe('visible');
  });

  it('honours the timeout, including 0 (disabled)', () => {
    expect(buildSelectorWaitOptions({ timeout: '1500' }).timeout).toBe(1500);
    expect(buildSelectorWaitOptions({ timeout: '0' }).timeout).toBe(0);
    expect(buildSelectorWaitOptions({ timeout: 0 }).timeout).toBe(0);
  });

  it('falls back to the default for empty/invalid/negative timeouts', () => {
    for (const timeout of ['', '   ', undefined, null, 'abc', '-5']) {
      expect(buildSelectorWaitOptions({ timeout }).timeout).toBe(30000);
    }
  });
});
