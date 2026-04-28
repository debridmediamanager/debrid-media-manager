import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository', () => ({
	repository: {
		recordRdOperation: vi.fn(),
		getRdStats: vi.fn(),
		getRdHourlyHistory: vi.fn(),
	},
}));

import { repository } from '@/services/repository';
import { getRdHourlyHistory, getRdStats, recordRdOperationEvent } from './rdOperationalStats';

const mockRecordRdOperation = vi.mocked(repository.recordRdOperation);
const mockGetRdStats = vi.mocked(repository.getRdStats);
const mockGetRdHourlyHistory = vi.mocked(repository.getRdHourlyHistory);

beforeEach(() => {
	vi.clearAllMocks();
	mockRecordRdOperation.mockResolvedValue(undefined as any);
});

describe('recordRdOperationEvent', () => {
	it('calls repository.recordRdOperation', () => {
		recordRdOperationEvent('unrestrict' as any, 200);

		expect(mockRecordRdOperation).toHaveBeenCalledWith('unrestrict', 200);
	});

	it('catches and logs errors without throwing', async () => {
		const error = new Error('db error');
		mockRecordRdOperation.mockRejectedValue(error);

		expect(() => recordRdOperationEvent('unrestrict' as any, 500)).not.toThrow();

		await vi.waitFor(() => {
			expect(console.error).toHaveBeenCalled();
		});
	});

	it('is no-op in browser environment', () => {
		const originalWindow = globalThis.window;
		const originalEnv = process.env.NODE_ENV;
		Object.defineProperty(globalThis, 'window', {
			value: {},
			writable: true,
			configurable: true,
		});
		(process.env as any).NODE_ENV = 'production';

		recordRdOperationEvent('unrestrict' as any, 200);

		expect(mockRecordRdOperation).not.toHaveBeenCalled();

		Object.defineProperty(globalThis, 'window', {
			value: originalWindow,
			writable: true,
			configurable: true,
		});
		(process.env as any).NODE_ENV = originalEnv;
	});
});

describe('getRdStats', () => {
	it('delegates to repository', async () => {
		const mockResult = { total: 100, success: 90 };
		mockGetRdStats.mockResolvedValue(mockResult as any);

		const result = await getRdStats(6);

		expect(mockGetRdStats).toHaveBeenCalledWith(6);
		expect(result).toBe(mockResult);
	});
});

describe('getRdHourlyHistory', () => {
	it('delegates to repository', async () => {
		const mockResult = [{ hour: '2024-01-01', count: 10 }];
		mockGetRdHourlyHistory.mockResolvedValue(mockResult as any);

		const result = await getRdHourlyHistory(24);

		expect(mockGetRdHourlyHistory).toHaveBeenCalledWith(24);
		expect(result).toBe(mockResult);
	});
});
