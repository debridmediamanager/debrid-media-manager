import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { runtimeConfig } = vi.hoisted(() => ({
	runtimeConfig: { externalSearchApiHostname: '' },
}));
const fetchMock = vi.fn();

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ imdbId }: { imdbId: string }) => <div data-testid="poster">{imdbId}</div>,
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	Toaster: () => <div data-testid="toast" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

vi.mock('next/config', () => ({
	__esModule: true,
	default: () => ({ publicRuntimeConfig: runtimeConfig }),
}));

import { clearCachedList } from '@/hooks/useCachedList';
import RecentlyUpdated from '@/pages/browse/recent';

describe('RecentlyUpdated page', () => {
	beforeEach(() => {
		clearCachedList();
		runtimeConfig.externalSearchApiHostname = '';
		fetchMock.mockReset();
		global.fetch = fetchMock as any;
	});

	it('fetches recent items on mount and renders posters', async () => {
		fetchMock.mockResolvedValue({
			json: () => Promise.resolve(['movie:tt1234']),
		});

		render(<RecentlyUpdated />);

		await waitFor(() => expect(screen.getByTestId('poster')).toBeInTheDocument());
		expect(fetchMock).toHaveBeenCalledWith('/api/browse/recent');
		expect(screen.getByRole('link', { name: /Go Home/i })).toHaveAttribute('href', '/');
	});

	it('uses the external search hostname when configured', async () => {
		runtimeConfig.externalSearchApiHostname = 'https://search.example';
		fetchMock.mockResolvedValue({
			json: () => Promise.resolve(['tv:tt999']),
		});

		render(<RecentlyUpdated />);

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(fetchMock).toHaveBeenCalledWith('https://search.example/api%2Fbrowse%2Frecent');
	});

	it('shows an error state when fetching fails', async () => {
		fetchMock.mockRejectedValue(new Error('network down'));
		render(<RecentlyUpdated />);

		await waitFor(() => expect(screen.getByText(/Error:/i)).toBeInTheDocument());
		expect(screen.getByText(/network down/i)).toBeInTheDocument();
	});
});
