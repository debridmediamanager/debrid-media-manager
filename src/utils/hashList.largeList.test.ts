import { publishHashlist } from '@/services/hashlists';
import type { UserTorrent } from '@/torrent/userTorrent';
import lzString from 'lz-string';
import { afterEach, expect, it, vi } from 'vitest';
import { generateHashList } from './hashList';

vi.mock('@/services/hashlists', () => ({ publishHashlist: vi.fn() }));
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

it('publishes all 7500 modelled library entries and reaches the result when popups are blocked', async () => {
	// Modelled scale input, not the reporter's unavailable library or a production publication.
	const library = Array.from({ length: 7500 }, (_, index) => ({
		id: `rd:${index}`,
		hash: index.toString(16).padStart(40, '0'),
		filename: `Library.Movie.${index}.2160p.mkv`,
		bytes: 40_000_000_000 + index,
	})) as UserTorrent[];
	const { promise, resolve } = Promise.withResolvers<string>();
	vi.mocked(publishHashlist).mockReturnValue(promise);
	vi.spyOn(window, 'open').mockReturnValue(null);
	const assign = vi.fn();
	const originalLocation = window.location;
	Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
	try {
		const sharing = generateHashList('Scale replay', library);
		const encoded = vi.mocked(publishHashlist).mock.calls[0][0];
		const published = JSON.parse(lzString.decompressFromEncodedURIComponent(encoded));
		expect(published).toEqual({
			title: 'Scale replay',
			torrents: library.map(({ hash, filename, bytes }) => ({ hash, filename, bytes })),
		});
		expect(assign).not.toHaveBeenCalled();
		resolve('/hashlist/replay-only');
		await sharing;
		expect(assign).toHaveBeenCalledWith('/hashlist/replay-only');
	} finally {
		Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
	}
});
