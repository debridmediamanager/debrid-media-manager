import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDelay = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/utils/delay', () => ({
	delay: mockDelay,
}));

import axiosWithRetry from '@/utils/axiosWithRetry';
import axios from 'axios';

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('axiosWithRetry', () => {
	it('returns response on successful request', async () => {
		vi.spyOn(axios, 'create').mockReturnValue(axiosWithRetry);
		const mockAdapter = vi.fn().mockResolvedValue({
			status: 200,
			data: { ok: true },
			headers: {},
			config: {},
			statusText: 'OK',
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		const response = await axiosWithRetry.get('/test');

		expect(response.status).toBe(200);
		expect(response.data).toEqual({ ok: true });
		expect(mockDelay).not.toHaveBeenCalled();
	});

	it('does not retry on 4xx errors other than 429', async () => {
		const mockAdapter = vi.fn().mockRejectedValue({
			response: { status: 400, headers: {} },
			config: {},
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		await expect(axiosWithRetry.get('/test')).rejects.toMatchObject({
			response: { status: 400 },
		});
		expect(mockDelay).not.toHaveBeenCalled();
	});

	it('does not retry on 403 errors', async () => {
		const mockAdapter = vi.fn().mockRejectedValue({
			response: { status: 403, headers: {} },
			config: {},
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		await expect(axiosWithRetry.get('/test')).rejects.toMatchObject({
			response: { status: 403 },
		});
		expect(mockDelay).not.toHaveBeenCalled();
	});

	it('retries on 429 status', async () => {
		let callCount = 0;
		const mockAdapter = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.reject({
					response: { status: 429, headers: {} },
					config: { __retryCount: undefined },
				});
			}
			return Promise.resolve({
				status: 200,
				data: { ok: true },
				headers: {},
				config: {},
				statusText: 'OK',
			});
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		const response = await axiosWithRetry.get('/test');

		expect(response.status).toBe(200);
		expect(mockDelay).toHaveBeenCalled();
	});

	it('retries on 500 status', async () => {
		let callCount = 0;
		const mockAdapter = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.reject({
					response: { status: 500, headers: {} },
					config: { __retryCount: undefined },
				});
			}
			return Promise.resolve({
				status: 200,
				data: { recovered: true },
				headers: {},
				config: {},
				statusText: 'OK',
			});
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		const response = await axiosWithRetry.get('/test');

		expect(response.status).toBe(200);
		expect(mockDelay).toHaveBeenCalled();
	});

	it('retries on 502 status', async () => {
		let callCount = 0;
		const mockAdapter = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.reject({
					response: { status: 502, headers: {} },
					config: { __retryCount: undefined },
				});
			}
			return Promise.resolve({
				status: 200,
				data: {},
				headers: {},
				config: {},
				statusText: 'OK',
			});
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		const response = await axiosWithRetry.get('/test');

		expect(response.status).toBe(200);
		expect(mockDelay).toHaveBeenCalled();
	});

	it('gives up after max retries', async () => {
		const mockAdapter = vi.fn().mockRejectedValue({
			response: { status: 500, headers: {} },
			config: { __retryCount: undefined },
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		await expect(axiosWithRetry.get('/test')).rejects.toMatchObject({
			response: { status: 500 },
		});

		expect(mockDelay).toHaveBeenCalledTimes(7);
	});

	it('respects Retry-After header', async () => {
		let callCount = 0;
		const mockAdapter = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.reject({
					response: { status: 429, headers: { 'retry-after': '5' } },
					config: { __retryCount: undefined },
				});
			}
			return Promise.resolve({
				status: 200,
				data: {},
				headers: {},
				config: {},
				statusText: 'OK',
			});
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		await axiosWithRetry.get('/test');

		expect(mockDelay).toHaveBeenCalledWith(5000);
	});

	it('has 30s request timeout configured', () => {
		expect(axiosWithRetry.defaults.timeout).toBe(30000);
	});

	it('rejects immediately when config is missing from error', async () => {
		const mockAdapter = vi.fn().mockRejectedValue({
			response: { status: 500, headers: {} },
		});
		axiosWithRetry.defaults.adapter = mockAdapter;

		await expect(axiosWithRetry.get('/test')).rejects.toBeDefined();
		expect(mockDelay).not.toHaveBeenCalled();
	});
});
