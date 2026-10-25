// @vitest-environment node
import handler from '@/pages/api/wanted/import';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { createMockResponse } from '@/test/utils/api';
import { activeSponsor } from '@/test/utils/sponsor';
import { SPONSOR_HEADER } from '@/utils/requireSponsor';
import { deflatedZipMember } from '@/utils/zipEntry';
import type { NextApiRequest } from 'next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/wanted', () => ({
	seasonsTmdbLacks: vi.fn().mockResolvedValue([{ title: 'Fruits Basket', seasons: [1] }]),
}));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const SONARR = join(
	__dirname,
	'../../../services/__fixtures__/sonarr_backup_v5.0.0.2569_2026.10.24_17.35.41.zip'
);

/** What the wanted page sends: the `.db` member, still deflated. */
async function upload(token: string, body: Buffer): Promise<NextApiRequest> {
	return Object.assign(Readable.from([body]), {
		method: 'POST',
		headers: { [SPONSOR_HEADER]: token, 'content-length': String(body.length) },
		query: {},
	}) as unknown as NextApiRequest;
}

describe('/api/wanted/import', () => {
	let token: string;
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		token = activeSponsor();
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	});
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.DMM_SPONSOR_SECRET;
	});

	it("adds what a Sonarr backup's database is searching for", async () => {
		const wantMany = vi.fn().mockResolvedValue({ added: 1, alreadyWanted: 1, overCap: 0 });
		vi.mocked(repository).wantMany = wantMany;
		const { data } = await deflatedZipMember(new Blob([readFileSync(SONARR)]), (n) =>
			n.endsWith('.db')
		);
		const res = createMockResponse();
		await handler(await upload(token, Buffer.from(await data.arrayBuffer())), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(wantMany).toHaveBeenCalledWith('ZP1M', [
			{ imdbId: 'tt0328738', kind: 'show', title: 'Fruits Basket', seasons: [1] },
			{ imdbId: 'tt8253044', kind: 'show', title: 'Hinamatsuri', seasons: [1] },
		]);
		expect(vi.mocked(res.json).mock.calls[0][0]).toEqual({
			app: 'sonarr',
			found: 2,
			added: 1,
			alreadyWanted: 1,
			overCap: 0,
			noImdbId: 0,
			notAvailable: 0,
			seasonsTmdbLacks: [{ title: 'Fruits Basket', seasons: [1] }],
		});
	});

	it('refuses a body that is not a deflated database', async () => {
		const res = createMockResponse();
		await handler(await upload(token, Buffer.from('not deflate at all')), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('is for sponsors only', async () => {
		const res = createMockResponse();
		await handler(await upload('', Buffer.from('')), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
