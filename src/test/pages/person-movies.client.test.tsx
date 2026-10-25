import longTitleCredits from '@/test/fixtures/responsive/person-credits-long-title.json';
import { render, screen } from '@testing-library/react';
import { useRouter } from 'next/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useCachedListMock } = vi.hoisted(() => ({
	useCachedListMock: vi.fn(),
}));

vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

vi.mock('@/hooks/useCachedList', () => ({
	useCachedList: useCachedListMock,
}));

vi.mock('@/components/poster', () => ({
	default: ({ title }: { title?: string }) => <div data-testid="poster">{title}</div>,
}));

describe('PersonMoviesPage responsive content', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			query: { personSlug: 'christopher-nolan' },
			pathname: '/person/[personSlug]/movies',
			asPath: '/person/christopher-nolan/movies',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);
		useCachedListMock.mockReturnValue({
			data: { movies: longTitleCredits, shows: longTitleCredits, all: [] },
			loading: false,
			error: null,
			refetch: vi.fn(),
			reset: vi.fn(),
		});
	});

	it('allows a long real credit title to wrap inside its narrow card', async () => {
		const PersonMoviesPage = (await import('@/pages/person/[personSlug]/movies')).default;
		render(<PersonMoviesPage />);

		const title = screen
			.getAllByText(longTitleCredits[0].title)
			.find((element) => element.classList.contains('text-sm'));
		expect(title).toHaveClass('break-words');
		expect(screen.getByText('as The Hen')).toHaveClass('text-gray-400');
	});

	it('puts appearances as themselves after real credits, in a collapsed group', async () => {
		useCachedListMock.mockReturnValue({
			data: {
				name: 'Lana Wachowski',
				movies: [
					{
						title: 'What is an Ocean… Reconnecting the Cast and Crew of Cloud Atlas',
						year: 2025,
						character: 'Self - Interviewee',
						mediaType: 'movie',
						creditType: 'cast',
						ids: { imdb: 'tt38643078' },
					},
					{
						title: 'The Matrix',
						year: 1999,
						job: 'Director · Writer · Producer',
						mediaType: 'movie',
						creditType: 'crew',
						ids: { imdb: 'tt0133093' },
					},
					{
						title: 'Cobalt Neural 9',
						year: null,
						job: 'Director · Writer',
						mediaType: 'movie',
						creditType: 'crew',
						ids: { imdb: 'tt1691119' },
					},
				],
				shows: [],
				all: [],
			},
			loading: false,
			error: null,
			refetch: vi.fn(),
			reset: vi.fn(),
		});
		const PersonMoviesPage = (await import('@/pages/person/[personSlug]/movies')).default;
		render(<PersonMoviesPage />);

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lana Wachowski');
		expect(screen.getByRole('link', { name: 'Movies (3)' })).toBeInTheDocument();
		expect(screen.queryByText('Movies', { selector: 'p' })).not.toBeInTheDocument();
		expect(screen.getByText('Director · Writer · Producer')).toBeInTheDocument();
		const group = screen.getByText('Appearances as themselves (1)').closest('details');
		expect(group).not.toHaveAttribute('open');
		expect(group).toHaveTextContent('Interviewee');
		expect(group).not.toHaveTextContent('Self');
		expect(
			screen.getByText('The Matrix', { selector: 'span' }).compareDocumentPosition(group!)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		// No empty year line under a title without a year.
		expect(
			screen.getByText('Cobalt Neural 9', { selector: 'span' }).parentElement
		).toHaveTextContent(/^Cobalt Neural 9$/);
	});
});
