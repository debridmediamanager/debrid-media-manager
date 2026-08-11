import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRouter = {
	pathname: '/transfers',
	asPath: '/transfers',
	query: {} as Record<string, string | string[]>,
	push: vi.fn(),
	replace: vi.fn().mockResolvedValue(true),
	events: { on: vi.fn(), off: vi.fn() },
};

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => mockRouter,
}));

vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useRealDebridAccessToken: () => ['test-rd-key', false, false],
}));

const mockAddHashAsMagnet = vi.fn().mockResolvedValue('rd-torrent-id');
const mockSelectFiles = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/realDebrid', () => ({
	__esModule: true,
	addHashAsMagnet: (...args: any[]) => mockAddHashAsMagnet(...args),
	selectFiles: (...args: any[]) => mockSelectFiles(...args),
}));

import TransfersPage from '@/pages/transfers';
import { getTrackedDebridUploaderJobs, trackDebridUploaderJob } from '@/utils/debridUploader';

const HASH = 'a'.repeat(40);
const REWRITTEN = 'b'.repeat(40);

const completedJobResponse = () => ({
	ok: true,
	status: 200,
	json: async () => ({
		id: 'job-1',
		status: 'completed',
		info_hash: REWRITTEN,
		name: 'Tracked Movie',
	}),
});

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completedJobResponse()));
});

// A transfer started by somebody else finishes in *their* RD account. The send
// flow adds it to this user's RD when the page that joined it is still open —
// the Transfers page is what closes the gap for everyone who navigated away.
describe('Transfers page RD handoff', () => {
	it('adds a joined transfer to RD once it has completed', async () => {
		trackDebridUploaderJob({
			id: 'job-1',
			hash: HASH,
			imdbId: 'tt1234567',
			title: 'Tracked Movie',
			createdAt: 1700000000000,
			adopted: true,
		});

		render(<TransfersPage />);

		await waitFor(() =>
			expect(mockAddHashAsMagnet).toHaveBeenCalledWith('test-rd-key', REWRITTEN, true)
		);
		expect(mockSelectFiles).toHaveBeenCalledWith('test-rd-key', 'rd-torrent-id', ['all'], true);
		await waitFor(() => expect(getTrackedDebridUploaderJobs()[0].rdAdded).toBe(true));
	});

	it('leaves a transfer this browser started alone', async () => {
		trackDebridUploaderJob({
			id: 'job-1',
			hash: HASH,
			imdbId: 'tt1234567',
			createdAt: 1700000000000,
			adopted: false,
		});

		render(<TransfersPage />);

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
	});

	it('does not add a second copy of a transfer already handed over', async () => {
		trackDebridUploaderJob({
			id: 'job-1',
			hash: HASH,
			imdbId: 'tt1234567',
			createdAt: 1700000000000,
			adopted: true,
			rdAdded: true,
		});

		render(<TransfersPage />);

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
	});
});
