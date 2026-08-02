import handler from '@/pages/api/stremio/deletelink';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockValidateMethod,
	mockValidateToken,
	mockGenerateUserId,
	mockDeleteCastedLink,
	mockHandleApiError,
} = vi.hoisted(() => ({
	mockValidateMethod: vi.fn(),
	mockValidateToken: vi.fn(),
	mockGenerateUserId: vi.fn(),
	mockDeleteCastedLink: vi.fn(),
	mockHandleApiError: vi.fn(),
}));

vi.mock('@/utils/castApiHelpers', () => ({
	validateMethod: mockValidateMethod,
	validateToken: mockValidateToken,
	generateUserId: mockGenerateUserId,
	handleApiError: mockHandleApiError,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		deleteCastedLink: mockDeleteCastedLink,
	},
}));

describe('/api/stremio/deletelink', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateMethod.mockReturnValue(true);
		mockValidateToken.mockReturnValue('token');
		mockGenerateUserId.mockResolvedValue('user-1');
	});

	it('stops early when HTTP method is invalid', async () => {
		mockValidateMethod.mockReturnValue(false);
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(mockValidateToken).not.toHaveBeenCalled();
	});

	it('validates request body parameters', async () => {
		const req = createMockRequest({ method: 'POST', body: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing required parameters' });
		expect(mockDeleteCastedLink).not.toHaveBeenCalled();
	});

	it('deletes the casted link when parameters are valid', async () => {
		mockDeleteCastedLink.mockResolvedValue(true);
		const req = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGenerateUserId).toHaveBeenCalledWith('token');
		expect(mockDeleteCastedLink).toHaveBeenCalledWith('tt1', 'user-1', 'abc');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ message: 'Link deleted successfully' });
	});

	it('returns 404 when there is no matching link', async () => {
		mockDeleteCastedLink.mockResolvedValue(false);
		const req = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({ error: 'Link not found' });
	});

	it('delegates unexpected errors to the API error handler', async () => {
		mockDeleteCastedLink.mockRejectedValue(new Error('db down'));
		const req = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHandleApiError).toHaveBeenCalledWith(
			expect.any(Error),
			res,
			expect.stringContaining('Failed to delete link')
		);
	});
});
