import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMdblistClient } from './mdblistClient';
import { resolveTvdbId, tvdbIdFrom } from './tvdbLookup';

vi.mock('./mdblistClient', () => ({ getMdblistClient: vi.fn() }));

const withInfo = (info: unknown) => {
	vi.mocked(getMdblistClient).mockReturnValue({
		getInfoByImdbId: vi.fn().mockResolvedValue(info),
	} as any);
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('tvdbIdFrom', () => {
	it('reads a numeric id', () => {
		expect(tvdbIdFrom({ tvdbid: 465664 })).toBe(465664);
	});

	it('accepts the string form, which MDBList sometimes sends instead', () => {
		expect(tvdbIdFrom({ tvdbid: '465664' })).toBe(465664);
	});

	// A movie has no tvdbid at all, and an unmapped show comes back with a blank
	// one — neither may turn into `tvdbid=0` on the indexer query.
	it('rejects anything that is not a usable id', () => {
		expect(tvdbIdFrom({ tvdbid: 0 })).toBeUndefined();
		expect(tvdbIdFrom({ tvdbid: null })).toBeUndefined();
		expect(tvdbIdFrom({ tvdbid: '' })).toBeUndefined();
		expect(tvdbIdFrom({ tvdbid: 'not-a-number' })).toBeUndefined();
		expect(tvdbIdFrom({ tvdbid: -1 })).toBeUndefined();
		expect(tvdbIdFrom({ tvdbid: 1.5 })).toBeUndefined();
		expect(tvdbIdFrom({})).toBeUndefined();
		expect(tvdbIdFrom(null)).toBeUndefined();
	});
});

describe('resolveTvdbId', () => {
	it('returns the id MDBList holds for the show', async () => {
		withInfo({ title: 'Stuart Fails to Save the Universe', type: 'show', tvdbid: 465664 });
		await expect(resolveTvdbId('tt27497393')).resolves.toBe(465664);
	});

	// The search still works off the IMDb id; losing the lookup must not lose the
	// whole section with it.
	it('falls back to undefined when the lookup throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(getMdblistClient).mockReturnValue({
			getInfoByImdbId: vi.fn().mockRejectedValue(new Error('MDBList down')),
		} as any);

		await expect(resolveTvdbId('tt27497393')).resolves.toBeUndefined();
	});

	it('falls back to undefined when the key is missing entirely', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(getMdblistClient).mockImplementation(() => {
			throw new Error('MDBLIST_KEY environment variable is not defined');
		});

		await expect(resolveTvdbId('tt27497393')).resolves.toBeUndefined();
	});
});
