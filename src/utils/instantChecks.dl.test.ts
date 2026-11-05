import type { SearchResult } from '@/services/mediasearch';
import { describe, expect, it, vi } from 'vitest';
import { checkAvailabilityDl } from './availability';
import { checkDatabaseAvailabilityDl } from './instantChecks';

vi.mock('./availability', async (importOriginal) => ({
	...(await importOriginal<typeof import('./availability')>()),
	checkAvailabilityDl: vi.fn(),
}));

const HASH = 'd9ce10dc915f4b6c2dfe960fb54cab2ecc31b381';
const row = (hash: string) => ({ hash, title: 'x', files: [] }) as unknown as SearchResult;

describe('checkDatabaseAvailabilityDl', () => {
	it('marks the rows DMM has seen whole on Debrid-Link, with their files', async () => {
		vi.mocked(checkAvailabilityDl).mockResolvedValue({
			available: [
				{ hash: HASH, files: [{ file_id: 0, path: 'Friends.S05E01.mkv', bytes: 9 }] },
			],
		});
		let rows = [row(HASH.toUpperCase()), row('e'.repeat(40))];
		const set = vi.fn((update: any) => (rows = update(rows)));
		const count = await checkDatabaseAvailabilityDl('k', 's', 'tt0108778', [HASH], set);
		expect(count).toBe(1);
		expect(checkAvailabilityDl).toHaveBeenCalledWith('k', 's', [HASH], 'tt0108778');
		expect(rows[0].dlAvailable).toBe(true);
		expect(rows[0].files).toEqual([{ fileId: 0, filename: 'Friends.S05E01.mkv', filesize: 9 }]);
		expect(rows[1].dlAvailable).toBeUndefined();
	});

	it('asks by hash alone on a page with no IMDb id', async () => {
		vi.mocked(checkAvailabilityDl).mockResolvedValue({ available: [] });
		await checkDatabaseAvailabilityDl('k', 's', '', [HASH], vi.fn());
		expect(checkAvailabilityDl).toHaveBeenLastCalledWith('k', 's', [HASH], undefined);
	});
});
