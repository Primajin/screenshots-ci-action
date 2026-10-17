import { describe, expect, it } from 'vitest';
import { formatBytes, parseFileName, renderCommentBody } from './comment.js';

const entry = (fileName, url, bytes = 1024) => ({
  fileName,
  name: `2026-10-16T10.00.00.000Z-${fileName}`,
  url,
  bytes,
});

describe('parseFileName', () => {
  it('detects parts before the commit hash', () => {
    expect(parseFileName('iPhone_13-part2-abc1234.jpeg')).toEqual({
      group: 'iPhone_13-abc1234.jpeg',
      part: 2,
    });
    expect(parseFileName('desktopPage540x405-part10.png')).toEqual({
      group: 'desktopPage540x405.png',
      part: 10,
    });
  });

  it('leaves other names alone', () => {
    expect(parseFileName('iPhone_13-abc1234.jpeg')).toEqual({
      group: 'iPhone_13-abc1234.jpeg',
      part: null,
    });
    expect(parseFileName('party-part-abc1234.jpeg').part).toBeNull();
  });
});

describe('formatBytes', () => {
  it('uses KB and MB', () => {
    expect(formatBytes(100)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('renderCommentBody', () => {
  it('renders single images exactly as before', () => {
    const body = renderCommentBody(
      [entry('iPhone_13-abc1234.jpeg', 'https://x/b.jpeg')],
      ['iPhone_13-abc1234.jpeg']
    );
    expect(body).toBe(
      '## 2026-10-16T10.00.00.000Z-iPhone_13-abc1234.jpeg\n- https://x/b.jpeg\n\n<img src=https://x/b.jpeg />\n\n'
    );
  });

  it('sorts single images by url like before', () => {
    const body = renderCommentBody(
      [entry('b.jpeg', 'https://x/z'), entry('a.jpeg', 'https://x/a')],
      ['b.jpeg', 'a.jpeg']
    );
    expect(body.indexOf('https://x/a')).toBeLessThan(
      body.indexOf('https://x/z')
    );
  });

  it('groups parts under one heading with adjacent images', () => {
    const files = [
      'iPhone_13-part1-abc1234.jpeg',
      'iPhone_13-part2-abc1234.jpeg',
      'iPhone_13-part10-abc1234.jpeg',
    ];
    // order follows the part number (10 sorts after 2), not the text
    const body = renderCommentBody(
      [
        entry(files[2], 'https://x/3', 3 * 1024 * 1024),
        entry(files[0], 'https://x/1', 1024 * 1024),
        entry(files[1], 'https://x/2', 1024 * 1024),
      ],
      files
    );
    expect(body).toContain(
      '## 2026-10-16T10.00.00.000Z-iPhone_13-abc1234.jpeg (10 parts, 5.0 MB total) (parts 3, 4, 5, 6, 7, 8, 9 failed to upload)\n'
    );
    expect(body).toContain(
      '- part 1 of 10: https://x/1\n- part 2 of 10: https://x/2\n- part 10 of 10: https://x/3\n'
    );
    expect(body).toContain(
      '<img src=https://x/1 alt="part 1 of 10" /><img src=https://x/2 alt="part 2 of 10" /><img src=https://x/3 alt="part 10 of 10" />\n\n'
    );
  });

  it('knows the part count even when a part failed to upload', () => {
    const files = ['a-part1.jpeg', 'a-part2.jpeg', 'a-part3.jpeg'];
    const body = renderCommentBody(
      [entry(files[0], 'https://x/1'), entry(files[2], 'https://x/3')],
      files
    );
    expect(body).toContain('(3 parts, 2 KB total) (part 2 failed to upload)');
    expect(body).toContain('part 3 of 3');
    expect(body).not.toContain('part 2 of 3');
  });

  it('names every part that failed to upload, also the last one', () => {
    const files = [
      'a-part1.jpeg',
      'a-part2.jpeg',
      'a-part3.jpeg',
      'a-part4.jpeg',
    ];
    const body = renderCommentBody([entry(files[0], 'https://x/1')], files);
    expect(body).toContain(
      '(4 parts, 1 KB total) (parts 2, 3, 4 failed to upload)'
    );
    const complete = renderCommentBody(
      files.map((file, index) => entry(file, `https://x/${index}`)),
      files
    );
    expect(complete).not.toContain('failed to upload');
  });

  it('mixes parts and single images', () => {
    const files = ['a-part1.png', 'a-part2.png', 'b.png'];
    const body = renderCommentBody(
      [
        entry(files[0], 'https://x/a1'),
        entry(files[1], 'https://x/a2'),
        entry(files[2], 'https://x/b'),
      ],
      files
    );
    expect(body.split('## ')).toHaveLength(3);
    expect(body.indexOf('https://x/a1')).toBeLessThan(
      body.indexOf('https://x/b')
    );
  });
});
