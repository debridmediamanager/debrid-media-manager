import adCheck from '@/pages/api/availability/ad/check';
import adCheck2 from '@/pages/api/availability/ad/check2';
import check from '@/pages/api/availability/check';
import check2 from '@/pages/api/availability/check2';
import playable from '@/pages/api/availability/playable';
import libraryIdentify from '@/pages/api/library/identify';
import sponsorIdentify from '@/pages/api/sponsor/identify';
import mediainfo from '@/pages/api/torrents/mediainfo';
import { validateDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { identifyFilenames } from '@/services/contentIdentifier';
import { repository } from '@/services/repository';
import captured from '@/test/fixtures/publicRoutes/page-and-script-requests.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import type { NextApiHandler, NextApiRequest } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/contentIdentifier');
vi.mock('@/utils/problemToken');
vi.mock('@/pages/api/zurg/auth');

const HASH = 'a'.repeat(40);
const token = { dmmProblemKey: 'key', solution: 'sig' };

// The routes DMM's pages call that answer what /api/sponsor/* sells.
const routes: [string, NextApiHandler, Partial<NextApiRequest>][] = [
	[
		'availability/check',
		check,
		{ method: 'POST', body: { ...token, imdbId: 'tt0133093', hashes: [HASH] } },
	],
	['availability/check2', check2, { method: 'POST', body: { ...token, hashes: [HASH] } }],
	[
		'availability/ad/check',
		adCheck,
		{ method: 'POST', body: { ...token, imdbId: 'tt0133093', hashes: [HASH] } },
	],
	['availability/ad/check2', adCheck2, { method: 'POST', body: { ...token, hashes: [HASH] } }],
	[
		'availability/playable',
		playable,
		{ method: 'POST', body: { ...token, service: 'rd', hashes: [HASH] } },
	],
	['torrents/mediainfo', mediainfo, { method: 'GET', query: { hash: HASH } }],
	[
		'library/identify',
		libraryIdentify,
		{
			method: 'POST',
			body: { items: [{ filename: 'The.Matrix.1999.1080p.BluRay.x264', hash: HASH }] },
		},
	],
];

const call = async (handler: NextApiHandler, req: Partial<NextApiRequest>, headers: object) => {
	const res = createMockResponse();
	await handler(
		createMockRequest({ ...req, headers: headers as NextApiRequest['headers'] }),
		res
	);
	return res;
};

describe('routes that serve DMM pages only', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(validateProblemToken).mockReturnValue(true);
		vi.mocked(validateDmmApiKeyHeader).mockResolvedValue(true);
		vi.mocked(identifyFilenames).mockResolvedValue([]);
		Object.assign(repository, {
			checkAvailability: vi.fn().mockResolvedValue([]),
			checkAvailabilityByHashes: vi.fn().mockResolvedValue([]),
			checkAvailabilityAd: vi.fn().mockResolvedValue([]),
			checkAvailabilityAdByHashes: vi.fn().mockResolvedValue([]),
			filterPlayableCachedHashes: vi.fn().mockResolvedValue([]),
			filterPlayableCachedHashesAd: vi.fn().mockResolvedValue([]),
			getLatestTorrentSnapshot: vi.fn().mockResolvedValue(null),
			getFilenameIdentifications: vi.fn().mockResolvedValue([]),
			getHashTitleIds: vi.fn().mockResolvedValue(new Map()),
			saveFilenameIdentifications: vi.fn().mockResolvedValue(undefined),
		});
	});

	it.each(routes)(
		'%s refuses a script, even one sending a DMM Referer',
		async (_, handler, req) => {
			const res = await call(handler, req, captured.script);
			expect(res._getStatusCode()).toBe(403);
			expect(JSON.stringify(res._getData())).toContain('/api-docs');
		}
	);

	it.each(routes)('%s answers a DMM page', async (_, handler, req) => {
		const res = await call(handler, req, captured.page);
		expect([200, 404]).toContain(res._getStatusCode());
	});

	it.each(routes)('%s refuses another site calling from a browser', async (_, handler, req) => {
		const res = await call(handler, req, { ...captured.page, 'sec-fetch-site': 'cross-site' });
		expect(res._getStatusCode()).toBe(403);
	});

	// a self-hosted DMM on a LAN address: plain http, so the browser sends no Sec-Fetch-*
	it.each(routes)('%s answers a self-hosted page over plain http', async (_, handler, req) => {
		const {
			'sec-fetch-site': _s,
			'sec-fetch-mode': _m,
			'sec-fetch-dest': _d,
			...page
		} = captured.page;
		const res = await call(handler, req, { ...page, 'x-forwarded-proto': 'http' });
		expect([200, 404]).toContain(res._getStatusCode());
	});

	it('leaves /api/sponsor/identify to the sponsor key', async () => {
		const [, , req] = routes.find(([name]) => name === 'library/identify')!;
		const res = await call(sponsorIdentify, req, captured.script);
		expect(res._getStatusCode()).toBe(200);
	});
});
