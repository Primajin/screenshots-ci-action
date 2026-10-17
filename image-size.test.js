import {Buffer} from 'node:buffer';
import {describe, expect, it} from 'vitest';
import {readImageSize} from './image-size.js';

const png = (width, height) => {
	const buffer = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buffer);
	buffer.writeUInt32BE(13, 8);
	buffer.write('IHDR', 12, 'ascii');
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
};

// SOI, an APP0 segment (to be skipped), then the SOF marker with the frame size
const jpeg = (width, height, marker = 0xC0) => {
	const app0 = Buffer.from([0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00]);
	const sof = Buffer.alloc(11);
	sof[0] = 0xFF;
	sof[1] = marker;
	sof.writeUInt16BE(9, 2);
	sof[4] = 8;
	sof.writeUInt16BE(height, 5);
	sof.writeUInt16BE(width, 7);
	return Buffer.concat([Buffer.from([0xFF, 0xD8]), app0, sof]);
};

describe('readImageSize', () => {
	it('reads a PNG', () => {
		expect(readImageSize(png(1170, 1992))).toEqual({width: 1170, height: 1992});
	});

	it('reads a JPEG after skipping other segments', () => {
		expect(readImageSize(jpeg(540, 405))).toEqual({width: 540, height: 405});
		expect(readImageSize(jpeg(10, 20, 0xC2))).toEqual({width: 10, height: 20});
	});

	it('skips fill bytes and DHT markers', () => {
		const dht = Buffer.from([0xFF, 0xC4, 0x00, 0x02]);
		const body = jpeg(7, 9);
		const withDht = Buffer.concat([
			body.subarray(0, 2),
			Buffer.from([0xFF]),
			dht,
			body.subarray(2),
		]);
		expect(readImageSize(withDht)).toEqual({width: 7, height: 9});
	});

	it('returns undefined for anything it cannot read', () => {
		expect(readImageSize(Buffer.from('GIF89a'))).toBeUndefined();
		expect(readImageSize(Buffer.alloc(0))).toBeUndefined();
		expect(readImageSize(png(1, 1).subarray(0, 20))).toBeUndefined();
		const brokenPng = png(1, 1);
		brokenPng.write('XXXX', 12, 'ascii');
		expect(readImageSize(brokenPng)).toBeUndefined();
		expect(readImageSize(png(0, 10))).toBeUndefined();
		expect(readImageSize(jpeg(5, 5).subarray(0, 12))).toBeUndefined();
		expect(readImageSize(Buffer.from([0xFF, 0xD8, 0x00, 0x00, 0x00]))).toBeUndefined();
		expect(readImageSize(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00]))).toBeUndefined();
	});
});
