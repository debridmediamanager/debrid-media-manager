import { describe, expect, it } from 'vitest';
import { buttonStyles, defaultLabels, icons } from './styles';

describe('buttonStyles', () => {
	it('exports all expected button style keys', () => {
		const expectedKeys = [
			'download',
			'watch',
			'cast',
			'castAll',
			'share',
			'delete',
			'magnet',
			'reinsert',
			'downloadAll',
			'exportLinks',
			'generateStrm',
			'searchAgain',
		];
		for (const key of expectedKeys) {
			expect(buttonStyles).toHaveProperty(key);
			expect(typeof buttonStyles[key as keyof typeof buttonStyles]).toBe('string');
		}
	});

	it('all styles contain border and bg class patterns', () => {
		for (const [, value] of Object.entries(buttonStyles)) {
			expect(value).toMatch(/border-2/);
			expect(value).toMatch(/bg-/);
		}
	});
});

describe('icons', () => {
	it('exports SVG strings for action types', () => {
		const svgKeys = ['download', 'watch', 'cast', 'share', 'delete', 'magnet', 'reinsert'];
		for (const key of svgKeys) {
			const svg = icons[key as keyof typeof icons];
			expect(svg).toContain('<svg');
		}
	});

	it('searchAgain icon is an empty string', () => {
		expect(icons.searchAgain).toBe('');
	});
});

describe('defaultLabels', () => {
	it('exports human-readable labels for all action types', () => {
		expect(defaultLabels.download).toBe('Download');
		expect(defaultLabels.watch).toBe('Watch');
		expect(defaultLabels.cast).toBe('Cast');
		expect(defaultLabels.delete).toBe('Delete');
		expect(defaultLabels.magnet).toBe('Copy');
		expect(defaultLabels.reinsert).toBe('Reinsert');
		expect(defaultLabels.downloadAll).toBe('Download All');
		expect(defaultLabels.exportLinks).toBe('Get Links');
		expect(defaultLabels.generateStrm).toBe('STRM Files');
		expect(defaultLabels.searchAgain).toBe('Search again');
		expect(defaultLabels.share).toBe('Hashlist');
	});
});
