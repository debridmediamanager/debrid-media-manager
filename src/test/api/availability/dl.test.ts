import submit from '@/pages/api/availability/dl';
import check from '@/pages/api/availability/dl/check';
import remove from '@/pages/api/availability/dl/remove';
import { repository } from '@/services/repository';
import dlMovie from '@/test/fixtures/libraryAvailability/dl_movie.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	stubDlProbeAccount,
	unstubDlProbeAccount,
	verityMiss,
	verityPartial,
	verityWhole,
} from '@/test/utils/dlProbeAccount';
import { validateProblemToken } from '@/utils/problemToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const mockRepository = vi.mocked(repository);
const token = { dmmProblemKey: 'key-1-1234567890', solution: 'solution-hash' };

// real seedbox rows from the Debrid-Link main account (2026-11-05), download URLs redacted
const body = (torrent: typeof dlMovie, imdbId: string, overrides: object = {}) => ({
	...token,
	hash: torrent.hashString,
	imdbId,
	filename: torrent.name,
	files: torrent.files.map(({ name, size, downloadPercent }) => ({
		name,
		size,
		downloadPercent,
	})),
	...overrides,
});

const call = async (handler: any, req: object) => {
	const res = createMockResponse();
	await handler(
		createMockRequest({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, ...req }),
		res
	);
	return res;
};

describe('/api/availability/dl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(validateProblemToken).mockReturnValue(true);
		mockRepository.upsertAvailabilityDl = vi.fn().mockResolvedValue(undefined);
		mockRepository.checkAvailabilityDl = vi.fn().mockResolvedValue([]);
		mockRepository.removeAvailabilityDl = vi.fn().mockResolvedValue(undefined);
	});

	afterEach(unstubDlProbeAccount);

	// Until 2026-11-05 the route recorded whatever files and percentages a page posted, and
	// forgot any release on request. DMM now asks Debrid-Link itself with its probe account:
	// the recorded bare-hash adds of DMM's 25 largest Verity releases (2026-11-04).
	it('records a release Debrid-Link holds whole, from what Debrid-Link lists', async () => {
		const { held, calls } = stubDlProbeAccount();
		const hit = verityWhole[0];
		const listed = (hit.body as any).value;
		const res = await call(submit, {
			body: {
				...token,
				hash: hit.hash,
				imdbId: 'tt32261958',
				filename: 'Forged name',
				files: [{ name: 'forged.mkv', size: 1, downloadPercent: 100 }],
			},
		});
		expect(res.status).toHaveBeenCalledWith(200);
		const saved = vi.mocked(mockRepository.upsertAvailabilityDl).mock.calls[0][0];
		expect(saved).toEqual({
			hash: hit.hash,
			imdbId: 'tt32261958',
			filename: listed.name,
			files: listed.files.map((f: any) => ({ path: f.name, bytes: f.size })),
		});
		expect(held.size).toBe(0); // the probe torrent is removed again
		// and the account is read back, since a remove echoes any id
		const removeAt = calls.findIndex((c) => c.method === 'DELETE');
		expect(calls.slice(removeAt + 1).some((c) => c.url.includes('ids='))).toBe(true);
	});

	it('records nothing Debrid-Link refuses or only admitted part of, whatever the page says', async () => {
		const { held } = stubDlProbeAccount();
		for (const add of [verityMiss[0], verityPartial]) {
			const res = await call(submit, {
				body: {
					...body(dlMovie, 'tt32261958'),
					hash: add.hash,
				},
			});
			expect(res.status).toHaveBeenCalledWith(409);
		}
		expect(mockRepository.upsertAvailabilityDl).not.toHaveBeenCalled();
		expect(held.size).toBe(0);
	});

	// DMM's probe account is the main Debrid-Link account, whose library is in use: an add of a
	// hash it holds answers with that very torrent, which the probe's clean-up must not remove.
	it('answers from a torrent the probe account already holds and leaves it there', async () => {
		const mine = (verityWhole[1].body as any).value;
		const { held, calls } = stubDlProbeAccount([mine]);
		const res = await call(submit, {
			body: { ...token, hash: verityWhole[1].hash, imdbId: 'tt32261958' },
		});
		expect(res.status).toHaveBeenCalledWith(200);
		expect(held.has(mine.id)).toBe(true);
		expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
	});

	it('records nothing without an answer from Debrid-Link', async () => {
		const res = await call(submit, {
			body: { ...token, hash: verityWhole[0].hash, imdbId: 'tt32261958' },
		});
		expect(res.status).toHaveBeenCalledWith(503);
		expect(mockRepository.upsertAvailabilityDl).not.toHaveBeenCalled();
	});

	it('refuses a bad IMDb id and a bad token before asking Debrid-Link', async () => {
		const { calls } = stubDlProbeAccount();
		expect(
			(await call(submit, { body: { ...token, hash: verityWhole[0].hash, imdbId: 'x' } }))
				.status
		).toHaveBeenCalledWith(400);
		vi.mocked(validateProblemToken).mockReturnValue(false);
		expect(
			(await call(submit, { body: { ...token, hash: verityWhole[0].hash, imdbId: 'tt1' } }))
				.status
		).toHaveBeenCalledWith(403);
		expect(calls).toHaveLength(0);
	});

	it('forgets a release only when Debrid-Link refuses or only part-admits it', async () => {
		stubDlProbeAccount();
		for (const add of [verityMiss[0], verityPartial]) {
			const res = await call(remove, { body: { ...token, hash: add.hash, reason: 'x' } });
			expect(res.status).toHaveBeenCalledWith(200);
		}
		expect(vi.mocked(mockRepository.removeAvailabilityDl).mock.calls).toEqual([
			[verityMiss[0].hash],
			[verityPartial.hash],
		]);

		const kept = await call(remove, { body: { ...token, hash: verityWhole[0].hash } });
		expect(kept.status).toHaveBeenCalledWith(409);
		expect(mockRepository.removeAvailabilityDl).toHaveBeenCalledTimes(2);
	});

	it('forgets nothing without an answer from Debrid-Link', async () => {
		const res = await call(remove, { body: { ...token, hash: verityMiss[0].hash } });
		expect(res.status).toHaveBeenCalledWith(503);
		expect(mockRepository.removeAvailabilityDl).not.toHaveBeenCalled();
	});

	it('checks under an IMDb id, or by hash alone without one', async () => {
		await call(check, {
			body: { ...token, imdbId: 'tt1375666', hashes: [dlMovie.hashString] },
		});
		expect(mockRepository.checkAvailabilityDl).toHaveBeenLastCalledWith(
			[dlMovie.hashString],
			'tt1375666'
		);
		await call(check, { body: { ...token, hashes: [dlMovie.hashString] } });
		expect(mockRepository.checkAvailabilityDl).toHaveBeenLastCalledWith(
			[dlMovie.hashString],
			undefined
		);
		const tooMany = Array.from({ length: 101 }, () => dlMovie.hashString);
		expect(
			(await call(check, { body: { ...token, hashes: tooMany } })).status
		).toHaveBeenCalledWith(400);
	});
});
