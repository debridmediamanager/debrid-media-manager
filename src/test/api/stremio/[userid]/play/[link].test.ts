import handler from '@/pages/api/stremio/[userid]/play/[link]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { AxiosError, AxiosHeaders } from 'axios';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rdErrorResponse = (error: string, status: number) =>
	new AxiosError('rd', 'ERR', undefined, undefined, {
		status,
		statusText: '',
		headers: new AxiosHeaders(),
		config: { headers: new AxiosHeaders() },
		data: { error },
	});

const { mockUnrestrictLink, mockGetToken, mockRepository } = vi.hoisted(() => ({
	mockUnrestrictLink: vi.fn(),
	mockGetToken: vi.fn(),
	mockRepository: {
		getCastProfile: vi.fn(),
		getHashByLink: vi.fn(),
		removeAvailability: vi.fn(),
		removeAvailableFileByLinkPrefix: vi.fn(),
		deleteCastsByLinkPrefix: vi.fn(),
	},
}));

vi.mock('@/services/realDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/realDebrid')>()),
	unrestrictLink: mockUnrestrictLink,
	getToken: mockGetToken,
}));

vi.mock('@/services/repository', () => ({
	repository: mockRepository,
}));

describe('/api/stremio/[userid]/play/[link]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUnrestrictLink.mockResolvedValue({ download: 'https://rd/download' });
		mockGetToken.mockResolvedValue({ access_token: 'fresh-token' });
		mockRepository.getCastProfile.mockResolvedValue({
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});
		mockRepository.getHashByLink.mockResolvedValue(null);
		mockRepository.removeAvailability.mockResolvedValue(undefined);
		mockRepository.removeAvailableFileByLinkPrefix.mockResolvedValue(0);
		mockRepository.deleteCastsByLinkPrefix.mockResolvedValue(0);
	});

	it('validates required query params', async () => {
		const req = createMockRequest({ query: { userid: 'user' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid "userid" or "link" query parameter',
		});
	});

	it('unrestricts the link and redirects to the download URL', async () => {
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '127.0.0.1' },
		});
		const res = createMockResponse();
		(res.redirect as Mock).mockReturnValue(res);

		await handler(req, res);

		expect(mockGetToken).toHaveBeenCalledWith('client', 'secret', 'refresh', true);
		expect(mockUnrestrictLink).toHaveBeenCalledWith(
			'fresh-token',
			expect.stringContaining('https://real-debrid.com/d/abcdef123456'),
			'127.0.0.1',
			true
		);
		expect(res.redirect).toHaveBeenCalledWith('https://rd/download');
	});

	it('returns 500 when cast profile not found', async () => {
		mockRepository.getCastProfile.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '1.2.3.4' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get Cast profile for user user',
		});
	});

	it('returns 500 when token generation fails', async () => {
		mockGetToken.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '1.2.3.4' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get Real-Debrid token for user user',
		});
	});

	it('returns 500 when the link cannot be unrestricted', async () => {
		mockUnrestrictLink.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '127.0.0.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to unrestrict link' });
	});

	it('handles unexpected errors', async () => {
		mockUnrestrictLink.mockRejectedValue(new Error('rd down'));
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '1.2.3.4' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to play link' });
	});

	it('reports an error when unrestrict returns null, without deleting anything', async () => {
		mockUnrestrictLink.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '1.2.3.4' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
		expect(mockRepository.deleteCastsByLinkPrefix).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to unrestrict link' });
	});

	// Regression: the cleanup used to key on the 13-char link while the table
	// stores the 16-char form, so it never matched and nothing was ever dropped -
	// and had it matched it would have deleted the whole torrent's availability
	// for every user, on any failure at all.
	it.each(['hoster_unavailable', 'unavailable_file'])(
		'drops just the dead link when RD says %s',
		async (rdError) => {
			mockUnrestrictLink.mockRejectedValue(rdErrorResponse(rdError, 503));
			const req = createMockRequest({
				query: { userid: 'user', link: 'abcdef1234567890' },
				headers: { 'x-real-ip': '1.2.3.4' },
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(mockRepository.removeAvailableFileByLinkPrefix).toHaveBeenCalledWith(
				'https://real-debrid.com/d/abcdef1234567'
			);
			expect(mockRepository.deleteCastsByLinkPrefix).toHaveBeenCalledWith(
				'https://real-debrid.com/d/abcdef1234567'
			);
			expect(mockRepository.removeAvailability).not.toHaveBeenCalled();
			expect(res.status).toHaveBeenCalledWith(500);
		}
	);

	// `/unrestrict/link` has its own tight throttle that answers error 34 after a
	// handful of calls seconds apart - which is what Stremio resolving several
	// streams at once looks like. Deleting on that throws away live content.
	it.each([
		['too_many_requests', 429],
		['infringing_file', 451],
		['internal_error', 500],
	])('keeps the row when RD answers %s', async (rdError, status) => {
		mockUnrestrictLink.mockRejectedValue(rdErrorResponse(rdError, status));
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '1.2.3.4' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
		expect(mockRepository.deleteCastsByLinkPrefix).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('keeps the row when the request fails without an RD error body', async () => {
		mockUnrestrictLink.mockRejectedValue(new Error('socket hang up'));
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
			headers: { 'x-real-ip': '1.2.3.4' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
