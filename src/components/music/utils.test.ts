import { describe, expect, it } from 'vitest';
import { formatDuration, formatSize, removeExtension, shuffleArray } from './utils';

describe('formatDuration', () => {
	it('formats zero seconds', () => {
		expect(formatDuration(0)).toBe('0:00');
	});

	it('formats seconds less than a minute', () => {
		expect(formatDuration(45)).toBe('0:45');
	});

	it('formats exact minutes', () => {
		expect(formatDuration(120)).toBe('2:00');
	});

	it('formats minutes and seconds', () => {
		expect(formatDuration(185)).toBe('3:05');
	});

	it('pads seconds with leading zero', () => {
		expect(formatDuration(61)).toBe('1:01');
	});

	it('handles large durations', () => {
		expect(formatDuration(3661)).toBe('61:01');
	});

	it('handles NaN', () => {
		expect(formatDuration(NaN)).toBe('0:00');
	});

	it('handles Infinity', () => {
		expect(formatDuration(Infinity)).toBe('0:00');
	});

	it('floors fractional seconds', () => {
		expect(formatDuration(65.7)).toBe('1:05');
	});
});

describe('formatSize', () => {
	it('formats bytes as KB', () => {
		expect(formatSize(512 * 1024)).toBe('512.0 KB');
	});

	it('formats bytes as MB', () => {
		expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
	});

	it('formats bytes as GB', () => {
		expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
	});

	it('formats small values as KB', () => {
		expect(formatSize(1024)).toBe('1.0 KB');
	});

	it('formats just under 1MB as KB', () => {
		expect(formatSize(1024 * 1024 - 1)).toBe('1024.0 KB');
	});
});

describe('removeExtension', () => {
	it('removes .flac extension', () => {
		expect(removeExtension('01 - Song.flac')).toBe('01 - Song');
	});

	it('removes .mp3 extension', () => {
		expect(removeExtension('track.mp3')).toBe('track');
	});

	it('handles files with no extension', () => {
		expect(removeExtension('noext')).toBe('noext');
	});

	it('only removes last extension for double extensions', () => {
		expect(removeExtension('file.backup.mp3')).toBe('file.backup');
	});

	it('handles dotfiles (removes extension-like suffix)', () => {
		// The regex treats .hidden as an extension and removes it
		expect(removeExtension('.hidden')).toBe('');
	});
});

describe('shuffleArray', () => {
	it('returns array of same length', () => {
		const arr = [1, 2, 3, 4, 5];
		expect(shuffleArray(arr)).toHaveLength(5);
	});

	it('contains same elements', () => {
		const arr = [1, 2, 3, 4, 5];
		const shuffled = shuffleArray(arr);
		expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it('does not mutate original array', () => {
		const arr = [1, 2, 3, 4, 5];
		const original = [...arr];
		shuffleArray(arr);
		expect(arr).toEqual(original);
	});

	it('handles empty array', () => {
		expect(shuffleArray([])).toEqual([]);
	});

	it('handles single element', () => {
		expect(shuffleArray([42])).toEqual([42]);
	});
});
