import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheck = vi.fn();

vi.unmock('@/services/rateLimit/withRateLimit');

vi.mock('./middlewareRateLimiter', () => ({
	extractIdentifier: vi.fn().mockReturnValue('test-identifier'),
	getClientIp: vi.fn().mockReturnValue('1.2.3.4'),
	getRateLimitConfig: vi.fn().mockReturnValue({ rateLimit: 5, windowSeconds: 1 }),
	HybridRateLimiter: vi.fn().mockImplementation(() => ({
		check: mockCheck,
	})),
	RATE_LIMIT_CONFIGS: {
		stream: { rateLimit: 1, windowSeconds: 5 },
		torrents: { rateLimit: 1, windowSeconds: 2 },
		proxy: { rateLimit: 3, windowSeconds: 1 },
		report: { rateLimit: 5, windowSeconds: 10 },
		default: { rateLimit: 5, windowSeconds: 1 },
	},
}));

import { withCustomRateLimit, withIpRateLimit, withRateLimit } from './withRateLimit';

beforeEach(() => {
	vi.clearAllMocks();
	mockCheck.mockReset();
});

describe('withRateLimit', () => {
	it('calls inner handler and sets headers when rate limit succeeds', async () => {
		mockCheck.mockResolvedValue({
			success: true,
			remaining: 4,
			reset: Date.now() + 1000,
			limit: 5,
		});
		const innerHandler = vi.fn();
		const wrapped = withRateLimit(innerHandler);
		const req = createMockRequest({
			url: '/api/some/path',
			headers: { 'cf-connecting-ip': '10.0.0.1' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(innerHandler).toHaveBeenCalledWith(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
		expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '4');
	});

	it('returns 429 when rate limit is exceeded', async () => {
		const resetTime = Date.now() + 5000;
		mockCheck.mockResolvedValue({
			success: false,
			remaining: 0,
			reset: resetTime,
			limit: 5,
		});
		const innerHandler = vi.fn();
		const wrapped = withRateLimit(innerHandler);
		const req = createMockRequest({
			url: '/api/test',
			headers: { 'cf-connecting-ip': '99.99.99.99' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(innerHandler).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(429);
		expect(res.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' });
		expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
	});

	it('sets X-RateLimit-Reset header', async () => {
		const resetTime = Date.now() + 10000;
		mockCheck.mockResolvedValue({
			success: true,
			remaining: 2,
			reset: resetTime,
			limit: 3,
		});
		const innerHandler = vi.fn();
		const wrapped = withRateLimit(innerHandler);
		const req = createMockRequest({
			url: '/api/test',
			headers: { 'cf-connecting-ip': '10.0.0.2' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', String(resetTime));
	});
});

describe('withCustomRateLimit', () => {
	it('passes custom config to limiter check', async () => {
		const customConfig = { rateLimit: 100, windowSeconds: 60 };
		mockCheck.mockResolvedValue({
			success: true,
			remaining: 99,
			reset: Date.now() + 60000,
			limit: 100,
		});
		const innerHandler = vi.fn();
		const wrapped = withCustomRateLimit(innerHandler, customConfig);
		const req = createMockRequest({
			url: '/api/custom',
			headers: { 'cf-connecting-ip': '88.88.88.88' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(mockCheck).toHaveBeenCalledWith('test-identifier', customConfig);
		expect(innerHandler).toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
	});

	it('returns 429 when custom rate limit is exceeded', async () => {
		const customConfig = { rateLimit: 2, windowSeconds: 30 };
		mockCheck.mockResolvedValue({
			success: false,
			remaining: 0,
			reset: Date.now() + 30000,
			limit: 2,
		});
		const innerHandler = vi.fn();
		const wrapped = withCustomRateLimit(innerHandler, customConfig);
		const req = createMockRequest({
			url: '/api/custom',
			headers: { 'cf-connecting-ip': '88.88.88.89' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(innerHandler).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(429);
	});
});

describe('withIpRateLimit', () => {
	it('calls inner handler when rate limit succeeds', async () => {
		const config = { rateLimit: 1, windowSeconds: 60 };
		mockCheck.mockResolvedValue({
			success: true,
			remaining: 0,
			reset: Date.now() + 60000,
			limit: 1,
		});
		const innerHandler = vi.fn();
		const wrapped = withIpRateLimit(innerHandler, config);
		const req = createMockRequest({
			url: '/api/torrents',
			headers: { 'cf-connecting-ip': '77.77.77.77' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(innerHandler).toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '1');
	});

	it('returns 429 when IP rate limit is exceeded', async () => {
		const config = { rateLimit: 1, windowSeconds: 60 };
		mockCheck.mockResolvedValue({
			success: false,
			remaining: 0,
			reset: Date.now() + 60000,
			limit: 1,
		});
		const innerHandler = vi.fn();
		const wrapped = withIpRateLimit(innerHandler, config);
		const req = createMockRequest({
			url: '/api/torrents',
			headers: { 'cf-connecting-ip': '66.66.66.66' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(innerHandler).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(429);
	});

	it('uses getClientIp for identifier extraction', async () => {
		const config = { rateLimit: 5, windowSeconds: 10 };
		mockCheck.mockResolvedValue({
			success: true,
			remaining: 4,
			reset: Date.now() + 10000,
			limit: 5,
		});
		const innerHandler = vi.fn();
		const wrapped = withIpRateLimit(innerHandler, config);
		const req = createMockRequest({
			url: '/api/torrents',
			headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1' },
		});
		const res = createMockResponse();

		await wrapped(req, res);

		expect(mockCheck).toHaveBeenCalledWith('1.2.3.4', config);
		expect(innerHandler).toHaveBeenCalled();
	});
});
