import handler from '@/pages/api/report/mass';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { mintProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReportContent } = vi.hoisted(() => ({
	mockReportContent: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		reportContent: mockReportContent,
	},
}));

const SECRET = 'test-problem-secret';

// A real minted pair rather than a mocked validator, so these tests exercise the
// same check production runs.
function auth() {
	const [dmmProblemKey, solution] = mintProblemToken(SECRET);
	return { dmmProblemKey, solution };
}

describe('/api/report/mass', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		// Legacy off: the old scheme's salt shipped in the browser bundle, so
		// leaving it on would let a forged token through and hide the regression
		// these tests exist to catch.
		process.env = { ...originalEnv, DMM_PROBLEM_SECRET: SECRET };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('rejects non-POST requests', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	// The gap this endpoint had: an IP rate limit was the only gate, and one
	// request became one DB write per element of an unbounded array.
	it('rejects and writes nothing when no token is provided', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: {
				reports: [{ hash: 'h1', imdbId: 'tt1' }],
				userId: 'user',
				type: 'porn',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication not provided' });
		expect(mockReportContent).not.toHaveBeenCalled();
	});

	it('rejects and writes nothing when the token is forged', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: {
				reports: [{ hash: 'h1', imdbId: 'tt1' }],
				userId: 'user',
				type: 'porn',
				dmmProblemKey: `deadbeef-${Math.floor(Date.now() / 1000)}`,
				solution: 'not-a-real-signature',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
		expect(mockReportContent).not.toHaveBeenCalled();
	});

	// The fan-out cap: 100 matches what the availability endpoints already allow.
	it('refuses more reports than the per-request cap and writes nothing', async () => {
		const reports = Array.from({ length: 101 }, (_, i) => ({
			hash: `h${i}`,
			imdbId: 'tt1',
		}));
		const req = createMockRequest({
			method: 'POST',
			body: { reports, userId: 'user', type: 'porn', ...auth() },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ message: 'Maximum 100 reports allowed' });
		expect(mockReportContent).not.toHaveBeenCalled();
	});

	it('accepts a request exactly at the cap', async () => {
		mockReportContent.mockResolvedValue(undefined);
		const reports = Array.from({ length: 100 }, (_, i) => ({
			hash: `h${i}`,
			imdbId: 'tt1',
		}));
		const req = createMockRequest({
			method: 'POST',
			body: { reports, userId: 'user', type: 'porn', ...auth() },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockReportContent).toHaveBeenCalledTimes(100);
	});

	it('validates payload shape', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { reports: [], userId: 'user', type: 'porn', ...auth() },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or empty reports array' });
	});

	it('requires valid report type and entries', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { reports: [{ hash: 'h1' }], userId: 'user', type: 'unknown', ...auth() },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);

		const req2 = createMockRequest({
			method: 'POST',
			body: { reports: [{ hash: 'h1' }], userId: 'user', type: 'porn', ...auth() },
		});
		const res2 = createMockResponse();

		await handler(req2, res2);

		expect(res2.status).toHaveBeenCalledWith(400);
		expect(res2.json).toHaveBeenCalledWith({
			message: 'Some reports are missing hash or imdbId',
		});
	});

	it('reports torrents in bulk and summarizes failures', async () => {
		mockReportContent.mockResolvedValue(undefined);
		mockReportContent.mockRejectedValueOnce(new Error('db'));

		const req = createMockRequest({
			method: 'POST',
			body: {
				reports: [
					{ hash: 'h1', imdbId: 'tt1' },
					{ hash: 'h2', imdbId: 'tt2' },
				],
				userId: 'user',
				type: 'porn',
				...auth(),
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockReportContent).toHaveBeenCalledTimes(2);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			reported: 1,
			failed: 1,
			errors: [{ hash: 'h1', error: 'db' }],
		});
	});

	it('handles unexpected failures gracefully', async () => {
		const error = new Error('boom');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'POST',
			body: {
				reports: [{ hash: 'h1', imdbId: 'tt1' }],
				userId: 'user',
				type: 'porn',
				...auth(),
			},
		});
		const res = createMockResponse();
		mockReportContent.mockImplementation(() => {
			throw error;
		});

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			reported: 0,
			failed: 1,
			errors: [{ hash: 'h1', error: 'boom' }],
		});
	});
});
