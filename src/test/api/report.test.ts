import handler from '@/pages/api/report';
import { repository } from '@/services/repository';
import { createMockRequest } from '@/test/utils/api';
import { mintProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
const mockRepository = vi.mocked(repository);

const SECRET = 'test-problem-secret';

// A real minted pair rather than a mocked validator, so these tests exercise the
// same check production runs.
function auth() {
	const [dmmProblemKey, solution] = mintProblemToken(SECRET);
	return { dmmProblemKey, solution };
}

describe('/api/report', () => {
	const originalEnv = process.env;
	let mockReq: any;
	let mockRes: any;

	beforeEach(() => {
		mockReq = createMockRequest();
		mockRes = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
			setHeader: vi.fn().mockReturnThis(),
			send: vi.fn().mockReturnThis(),
			_getStatusCode: () => 200,
			_getData: () => ({}),
			_getHeaders: () => ({}),
			_setStatusCode: vi.fn(),
		} as any;
		vi.clearAllMocks();
		// Legacy off: the old scheme's salt shipped in the browser bundle, so
		// leaving it on would let a forged token through and hide the regression
		// these tests exist to catch.
		process.env = { ...originalEnv, DMM_PROBLEM_SECRET: SECRET };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('should return 405 for non-POST requests', async () => {
		const methods = ['GET', 'PUT', 'DELETE', 'PATCH'];

		for (const method of methods) {
			vi.clearAllMocks();
			mockReq.method = method;
			await handler(mockReq, mockRes);

			expect(mockRes.status).toHaveBeenCalledWith(405);
			expect(mockRes.json).toHaveBeenCalledWith({ message: 'Method not allowed' });
		}
	});

	// The gap this endpoint had: an IP rate limit was the only gate, so anyone
	// could flag any hash and poison moderation.
	it('should return 403 and write nothing when no token is provided', async () => {
		mockRepository.reportContent = vi.fn().mockResolvedValue(undefined);
		mockReq.method = 'POST';
		mockReq.body = {
			hash: 'abc123',
			imdbId: 'tt1234567',
			userId: 'user123',
			type: 'porn',
		};

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(403);
		expect(mockRes.json).toHaveBeenCalledWith({
			errorMessage: 'Authentication not provided',
		});
		expect(mockRepository.reportContent).not.toHaveBeenCalled();
	});

	it('should return 403 and write nothing when the token is forged', async () => {
		mockRepository.reportContent = vi.fn().mockResolvedValue(undefined);
		mockReq.method = 'POST';
		mockReq.body = {
			hash: 'abc123',
			imdbId: 'tt1234567',
			userId: 'user123',
			type: 'porn',
			dmmProblemKey: `deadbeef-${Math.floor(Date.now() / 1000)}`,
			solution: 'not-a-real-signature',
		};

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(403);
		expect(mockRes.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
		expect(mockRepository.reportContent).not.toHaveBeenCalled();
	});

	it('should return 403 and write nothing when the token has expired', async () => {
		mockRepository.reportContent = vi.fn().mockResolvedValue(undefined);
		const [dmmProblemKey, solution] = mintProblemToken(SECRET, Date.now() - 10 * 60 * 1000);
		mockReq.method = 'POST';
		mockReq.body = {
			hash: 'abc123',
			imdbId: 'tt1234567',
			userId: 'user123',
			type: 'porn',
			dmmProblemKey,
			solution,
		};

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(403);
		expect(mockRes.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
		expect(mockRepository.reportContent).not.toHaveBeenCalled();
	});

	it('should return 400 when required fields are missing', async () => {
		mockReq.method = 'POST';
		mockReq.body = { hash: 'abc123', ...auth() }; // missing other fields
		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(400);
		expect(mockRes.json).toHaveBeenCalledWith({ message: 'Missing required fields' });
	});

	it('should return 400 when report type is invalid', async () => {
		mockReq.method = 'POST';
		mockReq.body = {
			hash: 'abc123',
			imdbId: 'tt1234567',
			userId: 'user123',
			type: 'invalid_type',
			...auth(),
		};
		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(400);
		expect(mockRes.json).toHaveBeenCalledWith({ message: 'Invalid report type' });
	});

	it('should return 500 when repository throws error', async () => {
		mockReq.method = 'POST';
		mockReq.body = {
			hash: 'abc123',
			imdbId: 'tt1234567',
			userId: 'user123',
			type: 'porn',
			...auth(),
		};

		mockRepository.reportContent = vi.fn().mockRejectedValue(new Error('Database error'));

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(500);
		expect(mockRes.json).toHaveBeenCalledWith({ message: 'Internal server error' });
	});

	it('should handle valid POST requests with all valid report types', async () => {
		const validTypes = ['porn', 'wrong_imdb', 'wrong_season'];

		for (const type of validTypes) {
			vi.clearAllMocks();
			mockReq.method = 'POST';
			mockReq.body = {
				hash: 'abc123',
				imdbId: 'tt1234567',
				userId: 'user123',
				type,
				...auth(),
			};

			mockRepository.reportContent = vi.fn().mockResolvedValue(undefined);

			await handler(mockReq, mockRes);

			expect(mockRepository.reportContent).toHaveBeenCalledWith(
				'abc123',
				'tt1234567',
				'user123',
				type
			);
			expect(mockRes.status).toHaveBeenCalledWith(200);
			expect(mockRes.json).toHaveBeenCalledWith({ success: true });
		}
	});
});
