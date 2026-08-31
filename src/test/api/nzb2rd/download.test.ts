import handler from '@/pages/api/nzb2rd/download';
import { fetchNzb } from '@/services/nzb2rd';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/nzb2rd', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/nzb2rd')>();
	return { ...actual, fetchNzb: vi.fn() };
});

const mockFetchNzb = vi.mocked(fetchNzb);

/** As DrunkenSlug serves it: watermarked head, DOCTYPE, poster and date. */
const RAW = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
	<head><meta type="tag">0a624180.27889905291</meta></head>
	<file poster="JWPKEi710Ds54@9WtdHEzo.2h0" date="1788097954" subject="[1/1] - &quot;My.File.mkv&quot; yEnc (1/1)">
		<groups><group>alt.binaries.test</group></groups>
		<segments><segment bytes="739000" number="1">part1@news</segment></segments>
	</file>
</nzb>`;

const run = async (query: Record<string, string>, method = 'GET') => {
	const req = createMockRequest({ method, query });
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockFetchNzb.mockResolvedValue(RAW);
});

describe('GET /api/nzb2rd/download', () => {
	it('serves the release with the indexer watermark gone', async () => {
		const res = await run({ id: 'ds:abc123', title: 'My.Release.1080p' });

		expect(res.status).toHaveBeenCalledWith(200);
		const body = res._getData() as string;
		expect(body).not.toContain('0a624180.27889905291');
		expect(body).not.toContain('poster=');
		expect(body).not.toMatch(/DOCTYPE/i);
		// The articles are what makes it the same download.
		expect(body).toContain('<segment bytes="739000" number="1">part1@news</segment>');
		expect(body).toContain('<groups>');
		expect(mockFetchNzb).toHaveBeenCalledWith('ds:abc123');
	});

	it('names the file after the release and says what came off', async () => {
		const res = await run({ id: 'ds:abc123', title: 'My.Release.1080p' });

		const headers = res._getHeaders();
		expect(headers['Content-Type']).toBe('application/x-nzb; charset=utf-8');
		expect(headers['Content-Disposition']).toContain('filename="My.Release.1080p.nzb"');
		expect(headers['Content-Disposition']).toContain("filename*=UTF-8''My.Release.1080p.nzb");
		expect(headers['X-Nzb-Removed']).toContain('<meta type="tag">');
		expect(headers['X-Nzb-Removed']).toContain('DOCTYPE');
	});

	it('falls back to the release id when no title is given', async () => {
		const res = await run({ id: 'ds:abc123' });

		expect(res._getHeaders()['Content-Disposition']).toContain('filename="dsabc123.nzb"');
	});

	// A colon is illegal in a filename on Windows and is what separates the
	// indexer prefix from the native id, so it cannot simply be passed through.
	it('keeps a quote or a control character out of the header', async () => {
		const res = await run({ id: 'ds:abc123', title: 'Quote".And\\Slash' });

		const disposition = res._getHeaders()['Content-Disposition'];
		expect(disposition).toContain('filename="Quote.AndSlash.nzb"');
		// A quote or backslash inside the value would end the parameter early and
		// leave the rest of the header to be read as syntax.
		expect(/filename="([^"]*)"/.exec(disposition)?.[1]).not.toMatch(/["\\]/);
	});

	it('lets the edge cache it, since every caller gets the same bytes', async () => {
		const res = await run({ id: 'ds:abc123' });

		expect(res._getHeaders()['Cache-Control']).toContain('s-maxage=3600');
	});

	it('rejects anything that is not an indexer result id', async () => {
		for (const id of ['', 'has spaces', 'x'.repeat(129), 'semi;colon']) {
			const res = await run({ id });
			expect(res.status).toHaveBeenCalledWith(400);
		}
		expect(mockFetchNzb).not.toHaveBeenCalled();
	});

	it('rejects a method other than GET', async () => {
		const res = await run({ id: 'ds:abc123' }, 'POST');

		expect(res.status).toHaveBeenCalledWith(405);
		expect(mockFetchNzb).not.toHaveBeenCalled();
	});

	it('reports an indexer that would not serve the NZB', async () => {
		mockFetchNzb.mockRejectedValue(new Error('DrunkenSlug refused the NZB: No such item'));

		const res = await run({ id: 'ds:abc123' });

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res._getData()).toEqual({
			error: 'Could not download the NZB from the indexer',
		});
	});

	// Both readers reject an NZB with no articles in it, so it is better refused
	// here than saved and opened in SABnzbd.
	it('refuses to serve a document with nothing to download', async () => {
		mockFetchNzb.mockResolvedValue('<nzb></nzb>');

		const res = await run({ id: 'ds:abc123' });

		expect(res.status).toHaveBeenCalledWith(502);
		expect(String((res._getData() as { error: string }).error)).toContain('not an NZB');
	});
});
