import handler from '@/pages/api/stremio/[userid]/play/[link]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUnrestrictLink, mockGetToken, mockRepository } = vi.hoisted(() => ({
	mockUnrestrictLink: vi.fn(),
	mockGetToken: vi.fn(),
	mockRepository: {
		getCastProfile: vi.fn(),
		getHashByLink: vi.fn(),
		removeAvailability: vi.fn(),
	},
}));

vi.mock('@/services/realDebrid', () => ({
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
			false
		);
		expect(res.redirect).toHaveBeenCalledWith('https://rd/download');
	});

	it('returns 500 when cast profile not found', async () => {
		mockRepository.getCastProfile.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
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
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to play link' });
	});

	it('reports file as unavailable when unrestrict returns null', async () => {
		mockUnrestrictLink.mockResolvedValue(null);
		mockRepository.getHashByLink.mockResolvedValue('abc123hash');
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getHashByLink).toHaveBeenCalledWith(
			'https://real-debrid.com/d/abcdef1234567'
		);
		expect(mockRepository.removeAvailability).toHaveBeenCalledWith('abc123hash');
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to play link' });
	});

	it('reports file as unavailable when unrestrict throws an error', async () => {
		mockUnrestrictLink.mockRejectedValue(new Error('link expired'));
		mockRepository.getHashByLink.mockResolvedValue('xyz789hash');
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getHashByLink).toHaveBeenCalledWith(
			'https://real-debrid.com/d/abcdef1234567'
		);
		expect(mockRepository.removeAvailability).toHaveBeenCalledWith('xyz789hash');
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to play link' });
	});

	it('does not call removeAvailability when hash is not found', async () => {
		mockUnrestrictLink.mockResolvedValue(null);
		mockRepository.getHashByLink.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', link: 'abcdef1234567890' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getHashByLink).toHaveBeenCalledWith(
			'https://real-debrid.com/d/abcdef1234567'
		);
		expect(mockRepository.removeAvailability).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
