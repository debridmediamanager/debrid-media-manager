import { validateDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const KEY = 'a'.repeat(64);

const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};

const LAPSED = { ...ACTIVE, isSponsor: false, sources: [] };

const request = (apiKey?: string) =>
	createMockRequest({ headers: apiKey ? { 'x-api-key': apiKey } : {} });

describe('validateDmmApiKeyHeader', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(repository.getSponsorByDmmApiKey).mockReset();
	});

	it('accepts a key belonging to an active sponsorship', async () => {
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(ACTIVE);
		const res = createMockResponse();

		await expect(validateDmmApiKeyHeader(request(KEY), res)).resolves.toBe(true);
		expect(res.status).not.toHaveBeenCalled();
		expect(repository.getSponsorByDmmApiKey).toHaveBeenCalledWith(KEY);
	});

	// The bug this replaces: the gate validated against the `DmmApiKeys` table,
	// a bare list of issued key strings with no expiry and no link back to a
	// sponsor. Every sponsor who ever lapsed kept these endpoints forever, and
	// gatekeeper's Reset API Key button left the old key working.
	it('rejects a key whose sponsorship has lapsed', async () => {
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(LAPSED);
		const res = createMockResponse();

		await expect(validateDmmApiKeyHeader(request(KEY), res)).resolves.toBe(false);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Sponsorship is no longer active' });
	});

	it('rejects a key no sponsorship carries', async () => {
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(null);
		const res = createMockResponse();

		await expect(validateDmmApiKeyHeader(request(KEY), res)).resolves.toBe(false);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
	});

	it('rejects a request with no key, without touching the database', async () => {
		const res = createMockResponse();

		await expect(validateDmmApiKeyHeader(request(), res)).resolves.toBe(false);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing x-api-key header' });
		expect(repository.getSponsorByDmmApiKey).not.toHaveBeenCalled();
	});
});
