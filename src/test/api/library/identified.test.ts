import handler, { MAX_CACHED_ITEMS } from '@/pages/api/library/identified';
import { identifyFilenames } from '@/services/contentIdentifier';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/contentIdentifier', () => ({ identifyFilenames: vi.fn() }));

const mockRepository = vi.mocked(repository);
const MAD_MAX = 'Mad.Max.Fury.Road.2015.2160p.UHD.BluRay.x265-TERMINAL';
const LAVA = 'Lava.2014.1080p.BluRay.x264';
const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const key = (name: string) => createHash('sha1').update(`auto3:${name}`).digest('hex');
const stored = (hash: string, name: string, confident: boolean) => ({
	hash,
	titleKey: key(name),
	filename: name,
	kind: 'movie',
	imdbId: 'tt1392190',
	title: 'Mad Max: Fury Road',
	year: 2015,
	score: 0.99,
	confident,
});

async function call(body: unknown) {
	const req = createMockRequest({ method: 'POST', body });
	const res = createMockResponse();
	await handler(req, res);
	return res;
}

describe('/api/library/identified', () => {
	beforeEach(() => {
		mockRepository.getFilenameIdentifications = vi
			.fn()
			.mockResolvedValue([stored(H1, MAD_MAX, true), stored(H2, LAVA, false)]);
	});

	it('answers from stored answers only, in order, and never asks the identifier', async () => {
		const res = await call({
			items: [
				{ filename: MAD_MAX, hash: H1.toUpperCase() },
				{ filename: LAVA, hash: H2 },
				{ filename: 'Never.Seen.2020.1080p', hash: 'c'.repeat(40) },
				{ filename: MAD_MAX },
			],
		});
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{ imdbId: 'tt1392190', title: 'Mad Max: Fury Road', year: 2015, kind: 'movie' },
				null,
				null,
				null,
			],
		});
		expect(identifyFilenames).not.toHaveBeenCalled();
	});

	it('refuses more than a batch', async () => {
		const items = Array.from({ length: MAX_CACHED_ITEMS + 1 }, () => ({
			filename: MAD_MAX,
			hash: H1,
		}));
		expect((await call({ items })).status).toHaveBeenCalledWith(400);
		expect(mockRepository.getFilenameIdentifications).not.toHaveBeenCalled();
	});

	it('serves DMM pages only', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { items: [{ filename: MAD_MAX, hash: H1 }] },
			headers: { 'sec-fetch-site': 'cross-site' },
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(403);
	});
});
