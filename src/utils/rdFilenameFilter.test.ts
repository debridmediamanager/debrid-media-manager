import rdNameFilterProbe from '@/test/fixtures/realdebrid/rd-name-filter-2026-10-03.json';
import { describe, expect, it } from 'vitest';
import { isRdBlockedFilename } from './rdFilenameFilter';

// This filter hides search results and Stremio streams, so it must give RD's
// own answer: an add is judged on the torrent's name, an unrestrict on the
// file's. Read from the recorded probe, a fresh webseed torrent per name.
describe('isRdBlockedFilename', () => {
	it.each(rdNameFilterProbe.add)("gives RD's add answer for $name", ({ name, status }) => {
		expect(isRdBlockedFilename(name)).toBe(status === 451);
	});
	it.each(rdNameFilterProbe.unrestrict)(
		"gives RD's unrestrict answer for $name",
		({ name, status }) => {
			expect(isRdBlockedFilename(name)).toBe(status === 451);
		}
	);
});
