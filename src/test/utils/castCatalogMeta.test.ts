import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	buildCatalogMetas,
	createCastCatalogPageHandler,
	parseCatalogExtra,
	skipFromExtra,
} from '@/utils/castCatalogMeta';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetTitles } = vi.hoisted(() => ({ mockGetTitles: vi.fn() }));

vi.mock('@/services/database/mdblistCache', () => ({
	getMdblistCacheService: () => ({ getTitles: mockGetTitles }),
}));

describe('buildCatalogMetas', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTitles.mockResolvedValue(new Map());
	});

	it('names every entry, because clients drop meta previews without one', async () => {
		mockGetTitles.mockResolvedValue(new Map([['tt100', 'The Shawshank Redemption']]));

		const metas = await buildCatalogMetas(['tt100', 'tt200'], 'movie');

		expect(metas).toEqual([
			{
				id: 'tt100',
				type: 'movie',
				name: 'The Shawshank Redemption',
				poster: 'https://images.metahub.space/poster/small/tt100/img',
			},
			{
				id: 'tt200',
				type: 'movie',
				name: 'tt200',
				poster: 'https://images.metahub.space/poster/small/tt200/img',
			},
		]);
	});

	it('looks the whole catalog up in one query', async () => {
		await buildCatalogMetas(['tt1', 'tt2', 'tt3'], 'series');

		expect(mockGetTitles).toHaveBeenCalledTimes(1);
		expect(mockGetTitles).toHaveBeenCalledWith(['tt1', 'tt2', 'tt3']);
	});
});

describe('parseCatalogExtra', () => {
	it('reads a single extra segment', () => {
		expect(parseCatalogExtra(['skip=24.json'])).toEqual({ skip: '24' });
	});

	it('reads several extras packed into one segment', () => {
		expect(parseCatalogExtra(['skip=24&genre=Action.json'])).toEqual({
			skip: '24',
			genre: 'Action',
		});
	});

	it('reads several extras spread across segments', () => {
		expect(parseCatalogExtra(['skip=1', 'limit=25.json'])).toEqual({
			skip: '1',
			limit: '25',
		});
	});

	it('decodes percent-encoded values', () => {
		expect(parseCatalogExtra(['genre=Sci%2DFi.json'])).toEqual({ genre: 'Sci-Fi' });
	});

	it('survives a malformed escape rather than throwing', () => {
		expect(parseCatalogExtra(['skip=5%.json'])).toEqual({ skip: '5%' });
	});

	it('ignores segments that are not key=value', () => {
		expect(parseCatalogExtra(['nonsense.json'])).toEqual({});
		expect(parseCatalogExtra(undefined)).toEqual({});
	});
});

describe('skipFromExtra', () => {
	it.each([
		[{ skip: '24' }, 24],
		[{ skip: '0' }, 0],
		[{}, 0],
		[{ skip: 'abc' }, 0],
		[{ skip: '-5' }, 0],
	])('reads %o as %i', (extra, expected) => {
		expect(skipFromExtra(extra)).toBe(expected);
	});
});

describe('createCastCatalogPageHandler', () => {
	const fetchIds = vi.fn();
	const handler = createCastCatalogPageHandler({
		type: 'movie',
		fetchIds,
		errorLabel: 'test casted movies',
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTitles.mockResolvedValue(new Map());
		fetchIds.mockResolvedValue(['tt1', 'tt2', 'tt3']);
	});

	it('returns the entries past what the client already has', async () => {
		const req = createMockRequest({ query: { userid: 'user123', extra: ['skip=2.json'] } });
		const res = createMockResponse();

		await handler(req, res);

		expect(fetchIds).toHaveBeenCalledWith('user123');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			metas: [expect.objectContaining({ id: 'tt3' })],
			hasMore: false,
			cacheMaxAge: 0,
		});
	});

	it('ends pagination with an empty page once the catalog runs out', async () => {
		const req = createMockRequest({ query: { userid: 'user123', extra: ['skip=100.json'] } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ metas: [], hasMore: false, cacheMaxAge: 0 });
	});

	it('serves the whole catalog when the extra carries no skip', async () => {
		const req = createMockRequest({
			query: { userid: 'user123', extra: ['genre=Action.json'] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			metas: [
				expect.objectContaining({ id: 'tt1' }),
				expect.objectContaining({ id: 'tt2' }),
				expect.objectContaining({ id: 'tt3' }),
			],
			hasMore: false,
			cacheMaxAge: 0,
		});
	});

	it('answers OPTIONS without touching the database', async () => {
		const req = createMockRequest({
			method: 'OPTIONS',
			query: { userid: 'user123', extra: ['skip=0.json'] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(fetchIds).not.toHaveBeenCalled();
	});

	it('rejects a missing userid', async () => {
		const req = createMockRequest({ query: { extra: ['skip=0.json'] } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(fetchIds).not.toHaveBeenCalled();
	});

	it('does not repeat the upgrade notice on later pages of a legacy token', async () => {
		const req = createMockRequest({ query: { userid: 'abcde', extra: ['skip=1.json'] } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ metas: [], cacheMaxAge: 0 });
		expect(fetchIds).not.toHaveBeenCalled();
	});

	it('reports a lookup failure as a 500', async () => {
		fetchIds.mockRejectedValue(new Error('db down'));
		const req = createMockRequest({ query: { userid: 'user123', extra: ['skip=0.json'] } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get test casted movies' });
	});
});
