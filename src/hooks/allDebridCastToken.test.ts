import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAllDebridCastToken } from './allDebridCastToken';

vi.mock('@/utils/allDebridCastApiClient', () => ({
	saveAllDebridCastProfile: vi.fn().mockResolvedValue('cast-token'),
	syncAllDebridCastSettings: vi.fn().mockResolvedValue('cast-token'),
}));

vi.mock('@/utils/browserStorage', () => ({
	getLocalStorageItemOrDefault: vi.fn().mockReturnValue('100'),
	getLocalStorageBoolean: vi.fn().mockReturnValue(false),
}));

vi.mock('@/utils/settings', () => ({
	defaultMovieSize: 2000,
	defaultEpisodeSize: 1000,
	defaultOtherStreamsLimit: 5,
}));

vi.mock('react-hot-toast', () => ({
	default: {
		error: vi.fn(),
	},
}));

const localStorageMock = vi.fn().mockReturnValue([null, vi.fn()]);
vi.mock('./localStorage', () => ({
	default: (...args: any[]) => localStorageMock(...args),
}));

import {
	saveAllDebridCastProfile,
	syncAllDebridCastSettings,
} from '@/utils/allDebridCastApiClient';

/** Wires up the three localStorage keys the hook reads. */
const withStorage = (
	values: { apiKey?: string | null; castToken?: string | null; syncedKey?: string | null },
	setters: { setToken?: ReturnType<typeof vi.fn>; setSyncedKey?: ReturnType<typeof vi.fn> } = {}
) => {
	localStorageMock.mockImplementation((key: string) => {
		if (key === 'ad:apiKey') return [values.apiKey ?? null, vi.fn()];
		if (key === 'ad:castToken') return [values.castToken ?? null, setters.setToken ?? vi.fn()];
		if (key === 'ad:castSyncedKey')
			return [values.syncedKey ?? null, setters.setSyncedKey ?? vi.fn()];
		return [null, vi.fn()];
	});
};

const flush = async () => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};

global.fetch = vi.fn();

describe('useAllDebridCastToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.mockReturnValue([null, vi.fn()]);
		global.fetch = vi.fn();
	});

	it('returns null when no API key is set', () => {
		const { result } = renderHook(() => useAllDebridCastToken());
		expect(result.current).toBeNull();
	});

	// The regression this hook was rewritten for: merely having AllDebrid linked
	// used to enrol the member in cast, which made our server call AllDebrid with
	// their key on every home page view and got them a security alert each time.
	it('makes no request at all for a linked member who never enrolled in cast', async () => {
		withStorage({ apiKey: 'test-key' });

		renderHook(() => useAllDebridCastToken());
		await flush();

		expect(saveAllDebridCastProfile).not.toHaveBeenCalled();
		expect(syncAllDebridCastSettings).not.toHaveBeenCalled();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('enrols only when the caller asks for it', async () => {
		const setToken = vi.fn();
		const setSyncedKey = vi.fn();
		withStorage({ apiKey: 'test-key' }, { setToken, setSyncedKey });

		renderHook(() => useAllDebridCastToken({ enroll: true }));
		await flush();

		expect(saveAllDebridCastProfile).toHaveBeenCalledTimes(1);
		expect(saveAllDebridCastProfile).toHaveBeenCalledWith('test-key', {
			movieMaxSize: 100,
			episodeMaxSize: 100,
			otherStreamsLimit: 100,
			hideCastOption: false,
		});
		expect(setToken).toHaveBeenCalledWith('cast-token');
		expect(setSyncedKey).toHaveBeenCalledWith('test-key');
	});

	it('resyncs an enrolled member through the token, spending no AllDebrid call', async () => {
		withStorage({ apiKey: 'test-key', castToken: 'cast-token', syncedKey: 'test-key' });

		const { result } = renderHook(() => useAllDebridCastToken());
		await flush();

		expect(syncAllDebridCastSettings).toHaveBeenCalledTimes(1);
		expect(syncAllDebridCastSettings).toHaveBeenCalledWith(
			'cast-token',
			'test-key',
			expect.objectContaining({ hideCastOption: false })
		);
		expect(saveAllDebridCastProfile).not.toHaveBeenCalled();
		expect(result.current).toBe('cast-token');
	});

	it('does a full save when the member rotated their API key', async () => {
		const setSyncedKey = vi.fn();
		withStorage(
			{ apiKey: 'new-key', castToken: 'cast-token', syncedKey: 'old-key' },
			{ setSyncedKey }
		);

		renderHook(() => useAllDebridCastToken());
		await flush();

		expect(saveAllDebridCastProfile).toHaveBeenCalledWith('new-key', expect.any(Object));
		expect(syncAllDebridCastSettings).not.toHaveBeenCalled();
		expect(setSyncedKey).toHaveBeenCalledWith('new-key');
	});

	it('returns the existing token', async () => {
		withStorage({ apiKey: 'test-key', castToken: 'existing-token', syncedKey: 'test-key' });

		const { result } = renderHook(() => useAllDebridCastToken());
		expect(result.current).toBe('existing-token');
	});

	it('leaves the synced key unset when the save fails, so a later render retries', async () => {
		const setToken = vi.fn();
		const setSyncedKey = vi.fn();
		vi.mocked(saveAllDebridCastProfile).mockResolvedValueOnce(null);
		withStorage({ apiKey: 'test-key' }, { setToken, setSyncedKey });

		renderHook(() => useAllDebridCastToken({ enroll: true }));
		await flush();

		expect(setToken).not.toHaveBeenCalled();
		expect(setSyncedKey).not.toHaveBeenCalled();
	});

	it('handles a thrown error gracefully', async () => {
		vi.mocked(saveAllDebridCastProfile).mockRejectedValueOnce(new Error('Network error'));
		withStorage({ apiKey: 'test-key' });

		const { result } = renderHook(() => useAllDebridCastToken({ enroll: true }));
		await flush();

		expect(result.current).toBeNull();
	});
});
