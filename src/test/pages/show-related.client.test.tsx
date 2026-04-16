import { clearCachedList } from '@/hooks/useCachedList';
import RelatedShowsPage from '@/pages/show/[imdbid]/related';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosGetMock, pushMock, routerState } = vi.hoisted(() => ({
	axiosGetMock: vi.fn(),
	pushMock: vi.fn().mockResolvedValue(undefined),
	routerState: {
		query: { imdbid: 'tt9876543' as string | undefined },
		isReady: true,
		push: vi.fn().mockResolvedValue(undefined),
	},
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
		query: routerState.query,
		isReady: routerState.isReady,
		push: pushMock,
	}),
}));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ imdbId, title }: { imdbId: string; title: string }) => (
		<div data-testid={`poster-${imdbId}`}>{title}</div>
	),
}));

describe('show related page', () => {
	beforeEach(() => {
		clearCachedList();
		axiosGetMock.mockReset();
		pushMock.mockClear();
		routerState.query = { imdbid: 'tt9876543' };
		routerState.isReady = true;
		window.open = vi.fn();
	});

	it('fetches related shows and navigates on click', async () => {
		axiosGetMock.mockResolvedValue({
			data: {
				results: [{ title: 'Sample Show', year: 2022, ids: { imdb: 'tt5556667' } }],
			},
		});

		render(<RelatedShowsPage />);

		await waitFor(() => expect(axiosGetMock).toHaveBeenCalledTimes(1));
		expect(axiosGetMock).toHaveBeenCalledWith(
			'/api/related/show',
			expect.objectContaining({
				params: { imdbId: 'tt9876543' },
			})
		);

		const relatedButton = await screen.findByRole('button', { name: /Sample Show/i });
		await userEvent.click(relatedButton);
		expect(pushMock).toHaveBeenCalledWith('/show/tt5556667/1');
	});

	it('opens the related show in a new tab when modifier is pressed', async () => {
		axiosGetMock.mockResolvedValue({
			data: {
				results: [{ title: 'Another Show', year: 2019, ids: { imdb: 'tt3334445' } }],
			},
		});

		render(<RelatedShowsPage />);

		const relatedButton = await screen.findByRole('button', { name: /Another Show/i });
		fireEvent.click(relatedButton, { metaKey: true });

		expect(window.open).toHaveBeenCalledWith('/show/tt3334445/1', '_blank');
		expect(pushMock).not.toHaveBeenCalled();
	});

	it('shows API-provided status messages', async () => {
		axiosGetMock.mockResolvedValue({
			data: {
				results: [],
				message: 'TMDB fallback exhausted.',
			},
		});

		render(<RelatedShowsPage />);

		expect(await screen.findByText('TMDB fallback exhausted.')).toBeInTheDocument();
		expect(screen.getByText('No related shows found.')).toBeInTheDocument();
	});

	it('defers navigation options until imdb id is available', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		routerState.query = { imdbid: '' };
		routerState.isReady = true;

		render(<RelatedShowsPage />);

		await waitFor(() => {
			expect(axiosGetMock).not.toHaveBeenCalled();
		});

		expect(screen.queryByRole('link', { name: 'Back to Show' })).not.toBeInTheDocument();
		const backToShow = screen.getByText('Back to Show');
		expect(backToShow).toHaveAttribute('aria-disabled', 'true');
		warnSpy.mockRestore();
	});
});
