import handler from '@/pages/api/availability/refresh';
import { listAllSeedboxTorrents } from '@/services/debridLink';
import { getUserTorrentsList } from '@/services/realDebrid';
import { repository } from '@/services/repository';
import dlList from '@/test/fixtures/debridlink/seedbox-list-2026-09-06.json';
import rdList from '@/test/fixtures/realdebrid/torrents-list-testacct123-2026-11-06.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');
vi.mock('@/services/realDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/realDebrid')>()),
	getUserTorrentsList: vi.fn(),
}));
vi.mock('@/services/debridLink', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/debridLink')>()),
	listAllSeedboxTorrents: vi.fn(),
}));

const token = { dmmProblemKey: 'key-1-1234567890', solution: 'solution-hash' };
const call = async (body: object) => {
	const res = createMockResponse();
	await handler(
		createMockRequest({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body }),
		res
	);
	return res;
};

// Cast offers a recorded release only while its row is fresh, and a library visit skipped every
// release DMM already knew, so releases members hold aged out of Cast. A visit now has DMM read
// the member's library from the provider and refresh the records it finds whole there.
describe('/api/availability/refresh', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(validateProblemToken).mockReturnValue(true);
		mockRepo().refreshAvailability = vi.fn().mockResolvedValue(3);
		mockRepo().refreshAvailabilityDl = vi.fn().mockResolvedValue(2);
	});
	const mockRepo = () => vi.mocked(repository) as any;

	it("refreshes the RD records of what RD lists downloaded in the member's library", async () => {
		const rows = [
			...rdList.torrents,
			// RD lists an unfinished add the same way; it proves nothing about the cache
			{ ...rdList.torrents[0], hash: 'f'.repeat(40), status: 'downloading', progress: 12 },
		];
		vi.mocked(getUserTorrentsList).mockResolvedValue({
			data: rows as any,
			totalCount: rows.length,
		});

		const res = await call({ ...token, service: 'rd', key: 'A'.repeat(52) });

		expect(getUserTorrentsList).toHaveBeenCalledWith('A'.repeat(52), 5000, 1, true);
		expect(mockRepo().refreshAvailability).toHaveBeenCalledWith(
			rdList.torrents.map((t) => t.hash.toLowerCase())
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual({ refreshed: 3 });
	});

	it("refreshes the Debrid-Link records of what Debrid-Link lists whole in the member's library", async () => {
		const torrents = dlList.pages.flatMap((p) => p.value as any[]);
		vi.mocked(listAllSeedboxTorrents).mockResolvedValue(torrents);

		const res = await call({ ...token, service: 'dl', key: 'dl-token' });

		const whole = torrents
			.filter((t) => t.status >= 100 || t.downloadPercent >= 100)
			.map((t) => t.hashString.toLowerCase());
		expect(whole.length).toBeGreaterThan(0);
		expect(mockRepo().refreshAvailabilityDl).toHaveBeenCalledWith(whole);
		expect(res._getData()).toEqual({ refreshed: 2 });
	});

	it('refuses a bad token, an unknown service and a missing key before asking anyone', async () => {
		for (const body of [
			{ ...token, service: 'ad', key: 'k' },
			{ ...token, service: 'rd' },
		]) {
			expect((await call(body)).status).toHaveBeenCalledWith(400);
		}
		vi.mocked(validateProblemToken).mockReturnValue(false);
		expect((await call({ ...token, service: 'dl', key: 'k' })).status).toHaveBeenCalledWith(
			403
		);
		expect(getUserTorrentsList).not.toHaveBeenCalled();
		expect(listAllSeedboxTorrents).not.toHaveBeenCalled();
	});

	it('answers 502 when the provider will not list the library', async () => {
		vi.mocked(listAllSeedboxTorrents).mockRejectedValue(new Error('floodDetected'));
		const res = await call({ ...token, service: 'dl', key: 'dl-token' });
		expect(res.status).toHaveBeenCalledWith(502);
		expect(mockRepo().refreshAvailabilityDl).not.toHaveBeenCalled();
	});
});
