import { useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import RequestsPage from '@/pages/requests';
import type { PublicRequest } from '@/utils/contentRequest';
import {
	fetchContentRequests,
	fetchMyContentRequests,
	fulfillContentRequest,
} from '@/utils/contentRequestsApi';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(),
	useTorBoxAccessToken: vi.fn(),
}));
vi.mock('@/utils/contentRequestsApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/contentRequestsApi')>()),
	fetchContentRequests: vi.fn(),
	fetchMyContentRequests: vi.fn(),
	fulfillContentRequest: vi.fn(),
	cancelContentRequest: vi.fn(),
}));

// The asker's row as the board serves it to a stranger.
const ROW: PublicRequest = {
	id: 'c0592ec4-3833-418d-94c6-006299d00566',
	hash: 'e6c7bbf548fe9dd66c9b96dbef07b2427970aa29',
	imdbId: 'tt38263629',
	title: 'Mag Mag [2025 WEB-DLRip-AVC]',
	mediaType: 'movie',
	status: 'open',
	createdAt: '2026-09-06T06:21:32.396Z',
	mine: false,
	jobId: null,
	tbCached: true,
	error: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.IntersectionObserver = class {
		observe() {}
		disconnect() {}
		unobserve() {}
	} as any;
	window.confirm = vi.fn(() => true);
	vi.mocked(fetchContentRequests).mockResolvedValue({
		requests: [ROW],
		authenticated: false,
		hasMore: false,
	});
	vi.mocked(fetchMyContentRequests).mockResolvedValue([]);
	vi.mocked(fulfillContentRequest).mockResolvedValue({ jobId: 'job-9', delivered: false });
});

// The fulfiller's Real-Debrid never takes part: the bytes come from their
// TorBox and land in the asker's Real-Debrid. The page used to hide Fulfil from
// anyone without both logins, turning away exactly the people with TorBox and no
// Real-Debrid that the board needs.
describe('RequestsPage for a fulfiller', () => {
	it('offers Fulfil with TorBox alone and sends no Real-Debrid key', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue('TB_KEY');
		render(<RequestsPage />);

		fireEvent.click(await screen.findByRole('button', { name: /Fulfil/ }));

		await waitFor(() =>
			expect(fulfillContentRequest).toHaveBeenCalledWith(null, ROW.id, { tbKey: 'TB_KEY' })
		);
		expect(screen.queryByText(/Sign in with Real-Debrid to fulfil/)).toBeNull();
	});

	it('still sends the Real-Debrid session when there is one', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['RD_TOKEN', false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue('TB_KEY');
		render(<RequestsPage />);

		fireEvent.click(await screen.findByRole('button', { name: /Fulfil/ }));

		await waitFor(() =>
			expect(fulfillContentRequest).toHaveBeenCalledWith('RD_TOKEN', ROW.id, {
				tbKey: 'TB_KEY',
			})
		);
	});

	it('offers no Fulfil without a TorBox key', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['RD_TOKEN', false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue(null as any);
		render(<RequestsPage />);

		await screen.findByText(ROW.title!);
		expect(screen.queryByRole('button', { name: /Fulfil/ })).toBeNull();
	});
});
