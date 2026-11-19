import { deleteStoredNzb } from '@/services/newznab/store';
import { repository } from '@/services/repository';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pruneWantedNzbs } from './wantedNzbs';

vi.mock('@/services/repository');
vi.mock('@/services/newznab/store', () => ({ deleteStoredNzb: vi.fn() }));

const db = vi.mocked(repository);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('pruneWantedNzbs', () => {
	beforeEach(() => {
		db.unreferencedWantedNzbs = vi.fn().mockResolvedValue([A, B]);
		db.forgetWantedNzb = vi.fn().mockResolvedValue(undefined);
	});

	// Uploads were never removed: every NZB a zurg ever sent stayed in the bucket,
	// and its row with it, long after the events that named it were pruned.
	it('deletes the upload no event names any more, then its row', async () => {
		vi.mocked(deleteStoredNzb).mockResolvedValue(true);
		expect(await pruneWantedNzbs()).toBe(2);
		expect(vi.mocked(deleteStoredNzb).mock.calls).toEqual([
			['wanted', A],
			['wanted', B],
		]);
		expect(db.forgetWantedNzb.mock.calls).toEqual([[A], [B]]);
	});

	it('keeps the row of an object the store could not delete, to try again', async () => {
		vi.mocked(deleteStoredNzb).mockImplementation(async (_p, sha) => sha === B);
		expect(await pruneWantedNzbs()).toBe(1);
		expect(db.forgetWantedNzb.mock.calls).toEqual([[B]]);
	});
});
