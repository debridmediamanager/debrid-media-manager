import debridHandler from '@/pages/api/debrid-uploader/jobs';
import nzbHandler from '@/pages/api/nzb2rd/jobs';
import { fetchNzb, submitNzb } from '@/services/nzb2rd';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { signSponsorToken } from '@/utils/sponsorToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/nzb2rd', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/nzb2rd')>();
	return { ...actual, fetchNzb: vi.fn(), submitNzb: vi.fn(), addHashToRdAccount: vi.fn() };
});
vi.mock('@/services/debridUploaderServers', () => ({
	orderedServersForNewJob: () => ['http://uploader.test'],
	resolveJobServer: vi.fn().mockResolvedValue(null),
}));

const mockRepo = vi.mocked(repository);
const mockSubmit = vi.mocked(submitNzb);
const HASH = 'a'.repeat(40);

function sponsorToken(): string {
	return signSponsorToken({
		shortId: 'ZP1M',
		githubUsername: 'someone',
		sources: ['github'],
		keyVersion: 1,
		exp: Date.now() + 3_600_000,
	});
}

beforeEach(() => {
	process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	vi.clearAllMocks();
	mockRepo.getNzb2rdTransfer = vi.fn().mockResolvedValue(null);
	mockRepo.recordNzb2rdTransferPending = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordTransferMeta = vi.fn().mockResolvedValue(undefined);
	mockRepo.addNzb2rdWaiter = vi.fn().mockResolvedValue(undefined);
	mockRepo.getDebridTransfer = vi.fn().mockResolvedValue(null);
	mockRepo.recordDebridTransferPending = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordDebridJobServer = vi.fn().mockResolvedValue(undefined);
	mockRepo.checkAvailabilityByHashes = vi.fn().mockResolvedValue([]);
	vi.mocked(fetchNzb).mockResolvedValue('<nzb></nzb>');
	mockSubmit.mockResolvedValue({ status: 201, data: { id: 'job-1', status: 'pending' } });
});

afterEach(() => {
	delete process.env.DMM_SPONSOR_SECRET;
});

const nzbBody = (over: Record<string, unknown> = {}) => ({
	id: 'release-1',
	title: 'Some.Release.1080p',
	imdbId: 'tt1418646',
	rdKey: 'rd-key',
	...over,
});

async function runNzb(headers: Record<string, string> = {}) {
	const req = createMockRequest({ method: 'POST', body: nzbBody(), headers });
	const res = createMockResponse();
	await nzbHandler(req as never, res as never);
	return res;
}

describe('usenet→RD carries a verified sponsorship, never a claimed one', () => {
	it('asks nzb2rd for the priority tier when the token verifies', async () => {
		await runNzb({ 'x-dmm-sponsor': sponsorToken() });
		expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ priority: true }));
	});

	it('does not when there is no token', async () => {
		await runNzb();
		expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ priority: false }));
	});

	it('does not on a forged token', async () => {
		// The payload is readable and therefore forgeable; only the signature is
		// trusted, and only here. A tampered one must buy nothing.
		const [payload] = sponsorToken().split('.');
		await runNzb({ 'x-dmm-sponsor': `${payload}.not-the-real-signature` });
		expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ priority: false }));
	});

	it('does not on an expired token', async () => {
		const expired = signSponsorToken({
			shortId: 'ZP1M',
			githubUsername: 'someone',
			sources: ['github'],
			keyVersion: 1,
			exp: Date.now() - 1,
		});
		await runNzb({ 'x-dmm-sponsor': expired });
		expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ priority: false }));
	});
});

describe('debrid→RD carries a verified sponsorship, never a claimed one', () => {
	async function runDebrid(headers: Record<string, string> = {}) {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ id: 'job-2', status: 'pending' }),
		});
		global.fetch = fetchMock as never;
		const req = createMockRequest({
			method: 'POST',
			body: { hash: HASH, imdbId: 'tt1418646', rdKey: 'rd-key', tbKey: 'tb-key' },
			headers,
		});
		const res = createMockResponse();
		await debridHandler(req as never, res as never);
		return fetchMock;
	}

	it('claims sponsorship to the uploader when the token verifies', async () => {
		const fetchMock = await runDebrid({ 'x-dmm-sponsor': sponsorToken() });
		const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/jobs'));
		expect(JSON.parse(call![1].body).sponsor).toBe(true);
	});

	it('does not when there is no token', async () => {
		const fetchMock = await runDebrid();
		const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/jobs'));
		expect(JSON.parse(call![1].body).sponsor).toBe(false);
	});

	it('does not on a forged token', async () => {
		const [payload] = sponsorToken().split('.');
		const fetchMock = await runDebrid({ 'x-dmm-sponsor': `${payload}.forged` });
		const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/jobs'));
		expect(JSON.parse(call![1].body).sponsor).toBe(false);
	});
});
