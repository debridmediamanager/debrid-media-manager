import { clearCachedList } from '@/hooks/useCachedList';
import RelatedMoviesPage from '@/pages/movie/[imdbid]/related';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosGetMock, pushMock } = vi.hoisted(() => ({
	axiosGetMock: vi.fn(),
	pushMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('axios', () => ({
	__esModule: true,
	default: { get: axiosGetMock },
}));

vi.mock('next/config', () => ({
	__esModule: true,
	default: () => ({ publicRuntimeConfig: { traktClientId: 'test-client' } }),
}));

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => ({
		query: { imdbid: 'tt1234567' },
		isReady: true,
		push: pushMock,
	}),
}));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ imdbId, title }: { imdbId: string; title: string }) => (
		<div data-testid={`poster-${imdbId}`}>{title}</div>
	),
}));

describe('movie related page', () => {
	beforeEach(() => {
		clearCachedList();
		axiosGetMock.mockReset();
		pushMock.mockClear();
		window.open = vi.fn();
	});

	it('fetches related movies and navigates on click', async () => {
		axiosGetMock.mockResolvedValue({
			data: {
				results: [{ title: 'Sample Movie', year: 2024, ids: { imdb: 'tt7654321' } }],
			},
		});

		render(<RelatedMoviesPage />);

		await waitFor(() => expect(axiosGetMock).toHaveBeenCalledTimes(1));
		expect(axiosGetMock).toHaveBeenCalledWith(
			'/api/related/movie',
			expect.objectContaining({
				params: { imdbId: 'tt1234567' },
			})
		);

		const relatedButton = await screen.findByRole('button', { name: /Sample Movie/i });
		await userEvent.click(relatedButton);
		expect(pushMock).toHaveBeenCalledWith('/movie/tt7654321');
	});

	it('opens the related movie in a new tab when modifier is pressed', async () => {
		axiosGetMock.mockResolvedValue({
			data: {
				results: [{ title: 'Another Movie', year: 2020, ids: { imdb: 'tt1112223' } }],
			},
		});

		render(<RelatedMoviesPage />);

		const relatedButton = await screen.findByRole('button', { name: /Another Movie/i });
		fireEvent.click(relatedButton, { ctrlKey: true });

		expect(window.open).toHaveBeenCalledWith('/movie/tt1112223', '_blank');
		expect(pushMock).not.toHaveBeenCalled();
	});

	it('surfaces API status messages to the user', async () => {
		axiosGetMock.mockResolvedValue({
			data: {
				results: [],
				message: 'Using fallback data.',
			},
		});

		render(<RelatedMoviesPage />);

		expect(await screen.findByText('Using fallback data.')).toBeInTheDocument();
		expect(screen.getByText('No related movies found.')).toBeInTheDocument();
	});
});
