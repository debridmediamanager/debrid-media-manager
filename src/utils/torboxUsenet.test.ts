import CREATED from '@/test/fixtures/torboxUsenet/usenet-create-2026-11-03.json';
import CACHED from '@/test/fixtures/torboxUsenet/usenet-create-cached-2026-11-03.json';
import PLAN_RESTRICTED from '@/test/fixtures/torboxUsenet/usenet-create-plan-restricted-2026-11-03.json';
import QUEUED from '@/test/fixtures/torboxUsenet/usenet-create-queued-2026-11-03.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendNzbToTorBox } from './torboxUsenet';

const createUsenetDownload = vi.fn();
vi.mock('@/services/torbox', () => ({
	createUsenetDownload: (...args: unknown[]) => createUsenetDownload(...args),
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response('<nzb/>', {
				status: 200,
				headers: { 'Content-Disposition': 'attachment; filename="Some.Release.nzb"' },
			})
		)
	);
});

afterEach(() => vi.unstubAllGlobals());

// Each answer is what TorBox returned to a real post on 2026-11-03.
describe('sendNzbToTorBox', () => {
	it('posts the cleaned NZB under its release name with the member key', async () => {
		createUsenetDownload.mockResolvedValue(CREATED);
		await expect(sendNzbToTorBox('tb-key', 'ds:1', 'Some Release')).resolves.toEqual({
			kind: 'started',
			usenetId: 2817595,
		});
		expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
			'/api/nzb2rd/download?id=ds%3A1'
		);
		const [key, params] = createUsenetDownload.mock.calls[0];
		expect(key).toBe('tb-key');
		expect(params.name).toBe('Some.Release');
		expect(params.file.name).toBe('Some.Release.nzb');
		expect(params.file.size).toBe('<nzb/>'.length);
		expect(params.file.type).toBe('application/x-nzb');
	});

	it('reads an NZB TorBox already held as cached', async () => {
		createUsenetDownload.mockResolvedValue(CACHED);
		await expect(sendNzbToTorBox('k', 'ds:1', 't')).resolves.toEqual({
			kind: 'cached',
			usenetId: 2817586,
		});
	});

	it('reads the no-free-slot answer as queued', async () => {
		createUsenetDownload.mockResolvedValue(QUEUED);
		await expect(sendNzbToTorBox('k', 'ds:1', 't')).resolves.toEqual({
			kind: 'queued',
			queuedId: 5343763,
		});
	});

	it('names the Pro plan when TorBox refuses the plan with a 403', async () => {
		createUsenetDownload.mockRejectedValue(
			Object.assign(new Error('Request failed with status code 403'), {
				response: { status: 403, data: PLAN_RESTRICTED },
			})
		);
		await expect(sendNzbToTorBox('k', 'ds:1', 't')).rejects.toThrow(
			'TorBox Usenet needs a Pro plan'
		);
	});

	it('passes on why DMM could not get the NZB, without posting', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: 'Could not download the NZB from the indexer' }), {
				status: 502,
			})
		);
		await expect(sendNzbToTorBox('k', 'ds:1', 't')).rejects.toThrow(
			'Could not download the NZB from the indexer'
		);
		expect(createUsenetDownload).not.toHaveBeenCalled();
	});
});
