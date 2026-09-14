import handler from '@/pages/api/sponsor/provider-key';
import { repository } from '@/services/repository';
import { ProviderProbeError } from '@/services/torznab/providerCache';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { activeSponsor, sponsorshipLapsed } from '@/test/utils/sponsor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const { validateMock } = vi.hoisted(() => ({ validateMock: vi.fn() }));
vi.mock('@/services/torznab/providerCache', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/torznab/providerCache')>();
	return { ...actual, validateProviderKey: (...args: unknown[]) => validateMock(...args) };
});

vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

const SHORT_ID = 'ZP1M';
const TB_KEY = 'tb-' + 'k'.repeat(30);

/** Mints the token *and* seeds the live row it names — the gate needs both. */
function token() {
	return activeSponsor({ shortId: SHORT_ID });
}

/** `_getData` is whatever was handed to `json` or `send`. */
function json(res: ReturnType<typeof createMockResponse>): any {
	return res._getData() as any;
}

async function call(method: string, body?: unknown, { authed = true }: { authed?: boolean } = {}) {
	const req = createMockRequest({
		method,
		body,
		headers: authed ? { 'x-dmm-sponsor': token() } : {},
	});
	const res = createMockResponse();
	await handler(req as never, res as never);
	return res;
}

beforeEach(() => {
	process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	vi.clearAllMocks();
	validateMock.mockResolvedValue(undefined);
	vi.mocked(repository.listSponsorProviderKeys).mockResolvedValue([]);
	vi.mocked(repository.setSponsorProviderKey).mockResolvedValue(undefined);
	vi.mocked(repository.removeSponsorProviderKey).mockResolvedValue(true);
	activeSponsor({ shortId: SHORT_ID });
});

afterEach(() => {
	delete process.env.DMM_SPONSOR_SECRET;
});

describe('/api/sponsor/provider-key', () => {
	// The badge in localStorage is forgeable; the signature on the token is not.
	// Anything that stores a credential has to go through the signed one.
	it('refuses a caller with no sponsor token', async () => {
		const res = await call('GET', undefined, { authed: false });

		expect(res._getStatusCode()).toBe(401);
		expect(repository.listSponsorProviderKeys).not.toHaveBeenCalled();
	});

	it('lists what this sponsor has linked, masked', async () => {
		vi.mocked(repository.listSponsorProviderKeys).mockResolvedValue([
			{ service: 'tb', hint: 'tb-k••••••••kkkk', updatedAt: new Date('2026-09-09') },
		]);

		const res = await call('GET');

		expect(res._getStatusCode()).toBe(200);
		const data = json(res);
		expect(data.linked).toEqual([
			{
				service: 'tb',
				label: 'TorBox',
				hint: 'tb-k••••••••kkkk',
				updatedAt: '2026-09-09T00:00:00.000Z',
			},
		]);
	});

	// The raw key is what a probe sends to the provider and nothing else. A
	// response that echoed it would put it in a browser's network log.
	it('never returns the stored key itself', async () => {
		const res = await call('POST', { service: 'tb', apiKey: TB_KEY });

		expect(JSON.stringify(json(res))).not.toContain(TB_KEY);
	});

	it('stores a key the provider accepts', async () => {
		const res = await call('POST', { service: 'tb', apiKey: TB_KEY });

		expect(res._getStatusCode()).toBe(200);
		expect(validateMock).toHaveBeenCalledWith('tb', TB_KEY);
		expect(repository.setSponsorProviderKey).toHaveBeenCalledWith(SHORT_ID, 'tb', TB_KEY);
	});

	// Checked before it is stored: a key that only fails at search time turns
	// into an empty feed, which reads as "no releases" rather than as a typo.
	it('refuses to store a key the provider rejects, and says why', async () => {
		validateMock.mockRejectedValue(new ProviderProbeError('tb', 'TorBox rejected that key'));

		const res = await call('POST', { service: 'tb', apiKey: 'wrong' });

		expect(res._getStatusCode()).toBe(400);
		expect(json(res).error).toBe('TorBox rejected that key');
		expect(repository.setSponsorProviderKey).not.toHaveBeenCalled();
	});

	// Real-Debrid and AllDebrid availability comes from DMM's own tables, so
	// there is nothing to link and the form must not pretend otherwise.
	it.each(['rd', 'ad', 'dl', 'nonsense'])('rejects %s as a linkable service', async (service) => {
		const res = await call('POST', { service, apiKey: TB_KEY });

		expect(res._getStatusCode()).toBe(400);
		expect(repository.setSponsorProviderKey).not.toHaveBeenCalled();
	});

	it('rejects an empty key without asking the provider', async () => {
		const res = await call('POST', { service: 'pm', apiKey: '   ' });

		expect(res._getStatusCode()).toBe(400);
		expect(validateMock).not.toHaveBeenCalled();
	});

	it('unlinks a service and answers with what is left', async () => {
		const res = await call('DELETE', { service: 'oc' });

		expect(res._getStatusCode()).toBe(200);
		expect(repository.removeSponsorProviderKey).toHaveBeenCalledWith(SHORT_ID, 'oc');
		expect(json(res).linked).toEqual([]);
	});

	it('turns away a method it does not implement', async () => {
		const res = await call('PUT', { service: 'tb', apiKey: TB_KEY });

		expect(res._getStatusCode()).toBe(405);
	});

	// The regression. A token minted while the pledge was live stays signed and
	// unexpired for up to SPONSOR_TOKEN_TTL_SECONDS after gatekeeper's sync zeroes
	// the row, so checking only the signature let a lapsed sponsor keep storing
	// provider credentials for a week after they stopped paying.
	it('refuses a caller whose sponsorship has lapsed since the token was minted', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { service: 'tb', apiKey: TB_KEY },
			headers: { 'x-dmm-sponsor': token() },
		});
		sponsorshipLapsed(SHORT_ID);

		const res = createMockResponse();
		await handler(req as never, res as never);

		expect(res._getStatusCode()).toBe(401);
		expect(json(res)).toEqual({ error: 'Sponsorship is no longer active' });
		expect(repository.setSponsorProviderKey).not.toHaveBeenCalled();
		expect(validateMock).not.toHaveBeenCalled();
	});

	// A lookup we could not perform is not a sponsorship that ended: telling an
	// active sponsor their pledge lapsed sends them back to gatekeeper for a key
	// that is already fine.
	it('answers 503 when the sponsorship cannot be read', async () => {
		const req = createMockRequest({
			method: 'GET',
			headers: { 'x-dmm-sponsor': token() },
		});
		vi.mocked(repository.getSponsorByShortId).mockRejectedValue(new Error('db down'));

		const res = createMockResponse();
		await handler(req as never, res as never);

		expect(res._getStatusCode()).toBe(503);
		expect(repository.listSponsorProviderKeys).not.toHaveBeenCalled();
	});
});
