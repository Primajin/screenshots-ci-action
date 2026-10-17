// Reads the pixel size of a PNG or JPEG from its header (no dependency). The PR
// comment uses it to put width and height on every image, so the page does not
// reflow when the pictures load. Anything unreadable gives undefined: the
// comment then simply omits the size.

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

// SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
const isSofMarker = marker =>
	marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker);

function readPng(buffer) {
	// 8 byte signature, 4 byte length, "IHDR", then width and height (uint32 BE).
	if (
		buffer.length < 24
		|| PNG_SIGNATURE.some((byte, index) => buffer[index] !== byte)
		|| buffer.toString('ascii', 12, 16) !== 'IHDR'
	) {
		return undefined;
	}

	return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

function readJpeg(buffer) {
	if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
		return undefined;
	}

	let offset = 2;
	while (offset + 4 <= buffer.length) {
		if (buffer[offset] !== 0xFF) {
			return undefined;
		}

		const marker = buffer[offset + 1];
		if (marker === 0xFF) {
			offset += 1; // Fill byte
			continue;
		}

		if (isSofMarker(marker)) {
			if (offset + 9 > buffer.length) {
				return undefined;
			}

			return {
				width: buffer.readUInt16BE(offset + 7),
				height: buffer.readUInt16BE(offset + 5),
			};
		}

		offset += 2 + buffer.readUInt16BE(offset + 2);
	}

	return undefined;
}

/**
 Pixel size of a PNG or JPEG.
 @param {Buffer} buffer File content.
 @returns {{width: number, height: number} | undefined} The size, or undefined when it cannot be read.
 */
function readImageSize(buffer) {
	const size = readPng(buffer) ?? readJpeg(buffer);
	return size && size.width > 0 && size.height > 0 ? size : undefined;
}

export {readImageSize};
