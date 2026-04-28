import { describe, expect, it, vi } from 'vitest';
import { handleSelectTorrent, resetSelection, selectShown } from './librarySelection';

describe('library selection helpers', () => {
	it('toggles the requested torrent id inside the selection set', () => {
		const original = new Set<string>(['one', 'two']);
		let latestSelection = new Set(original);
		const setter = vi.fn<(fn: (prev: Set<string>) => Set<string>) => void>((fn) => {
			latestSelection = fn(latestSelection);
		});

		handleSelectTorrent('two', original, setter);
		expect(latestSelection.has('two')).toBe(false);

		handleSelectTorrent('three', latestSelection, setter);
		expect(latestSelection.has('three')).toBe(true);
	});

	it('selects all torrents that are currently shown', () => {
		let result = new Set(['seed']);
		selectShown([{ id: 'a' }, { id: 'b' }] as any, (fn) => {
			result = fn(result);
		});
		expect(result).toEqual(new Set(['seed', 'a', 'b']));
	});

	it('resets the selection set', () => {
		let finalSet = new Set(['keep']);
		resetSelection((set) => {
			finalSet = set;
		});
		expect(finalSet).toEqual(new Set());
	});
});
