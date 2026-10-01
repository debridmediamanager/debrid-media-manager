import type { TraktSearchResult } from '@/services/trakt';
import { resetAnimeSuggestions } from '@/utils/animeSuggestions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { readFileSync } from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';

// Production's answers to both requests the dropdown makes, captured
// 2026-09-27; see src/test/fixtures/searchBar/README.md.
const fixture = (name: string) =>
	JSON.parse(readFileSync(path.resolve(__dirname, '../test/fixtures/searchBar', name), 'utf8'));

const push = vi.fn();

vi.mock('next/router', () => ({
	useRouter: () => ({ push }),
}));

vi.mock('axios', () => ({
	__esModule: true,
	default: { get: vi.fn() },
}));
const mockedGet = axios.get as ReturnType<typeof vi.fn>;

vi.mock('./poster', () => ({
	__esModule: true,
	default: ({ imdbId }: { imdbId: string }) => <div data-testid={`poster-${imdbId}`} />,
}));

const isTrakt = (url: unknown) => String(url).startsWith('/api/trakt/search');
const isAnime = (url: unknown) => String(url).startsWith('/api/search/anime');
const callsTo = (match: (url: unknown) => boolean) =>
	mockedGet.mock.calls.filter(([url]) => match(url));

describe('SearchBar', () => {
	beforeEach(() => {
		push.mockReset();
		mockedGet.mockReset();
		resetAnimeSuggestions();
	});

	const typeQuery = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
		const input = screen.getByPlaceholderText('Search movies & shows...');
		await user.clear(input);
		await user.type(input, value);
		return input;
	};

	it('debounces queries, shows suggestions, and routes movie selections', async () => {
		const user = userEvent.setup();
		const suggestion: TraktSearchResult = {
			type: 'movie',
			score: 100,
			movie: {
				title: 'Inception',
				year: 2010,
				ids: { imdb: 'tt1375666', trakt: 1 },
			},
		};
		mockedGet.mockResolvedValue({ data: [suggestion] });

		render(<SearchBar />);
		await typeQuery(user, 'Inception');

		await waitFor(() =>
			expect(mockedGet).toHaveBeenCalledWith(
				expect.stringContaining('/api/trakt/search?query=Inception')
			)
		);

		await user.click(await screen.findByText('Inception'));
		await waitFor(() => expect(push).toHaveBeenCalledWith('/movie/tt1375666'));
	});

	it('falls back to search routing when suggestion lacks an IMDb id', async () => {
		const user = userEvent.setup();
		const suggestion: TraktSearchResult = {
			type: 'show',
			score: 85,
			show: {
				title: 'Severance',
				year: 2022,
				ids: { trakt: 2 },
			},
		};
		mockedGet.mockResolvedValue({ data: [suggestion] });

		render(<SearchBar />);
		await typeQuery(user, 'Severance');
		await waitFor(() => expect(mockedGet).toHaveBeenCalled());

		await user.click(await screen.findByText('Severance'));
		await waitFor(() => expect(push).toHaveBeenCalledWith('/search?query=Severance'));
	});

	it('submits IMDb identifiers directly and generic queries through search page', async () => {
		render(<SearchBar />);
		const user = userEvent.setup();

		await typeQuery(user, 'tt7654321');
		await user.click(screen.getByRole('button', { name: /Search/i }));
		await waitFor(() => expect(push).toHaveBeenCalledWith('/x/tt7654321/'));

		push.mockClear();
		await typeQuery(user, 'Avatar');
		await user.click(screen.getByRole('button', { name: /Search/i }));
		await waitFor(() => expect(push).toHaveBeenCalledWith('/search?query=Avatar'));
	});

	it('closes suggestions when clicking outside and ignores short queries', async () => {
		const user = userEvent.setup();
		mockedGet.mockResolvedValue({
			data: [
				{
					type: 'movie',
					score: 92,
					movie: {
						title: 'Dune',
						year: 2021,
						ids: { imdb: 'tt1160419', trakt: 3 },
					},
				} as TraktSearchResult,
			],
		});

		render(<SearchBar />);
		await typeQuery(user, 'D');
		await new Promise((resolve) => setTimeout(resolve, 350));
		expect(mockedGet).not.toHaveBeenCalled();

		await typeQuery(user, 'Dune');
		await waitFor(() => expect(callsTo(isTrakt)).toHaveLength(1));

		await screen.findByText('Dune');
		fireEvent.mouseDown(document.body);
		await waitFor(() => expect(screen.queryByText('Dune')).toBeNull());
	});

	describe('anime suggestions', () => {
		type Answer = { data: unknown } | Error | 'pending';

		// Each endpoint answers from its own fixture, or fails, or never answers.
		const serve = (trakt: Answer, anime: Answer) => {
			const answer = (a: Answer) =>
				a === 'pending'
					? new Promise(() => {})
					: a instanceof Error
						? Promise.reject(a)
						: Promise.resolve(a);
			mockedGet.mockImplementation((url: string) => {
				if (isTrakt(url)) return answer(trakt);
				if (isAnime(url)) return answer(anime);
				return Promise.reject(new Error(`unexpected request ${url}`));
			});
		};
		const served = (query: string) => ({
			trakt: { data: fixture(`api-trakt-search-${query}.json`) },
			anime: { data: fixture(`api-search-anime-${query}.json`) },
		});

		it('lists AniDB entries under the movies and shows, capped at three', async () => {
			const user = userEvent.setup();
			const { trakt, anime } = served('frieren');
			serve(trakt, anime);

			render(<SearchBar />);
			await typeQuery(user, 'frieren');

			const group = await screen.findByRole('group', { name: 'Anime' });
			const rows = within(group)
				.getAllByRole('img')
				.map((img) => img.getAttribute('alt'));
			expect(rows).toEqual([
				'Sousou no Frieren poster',
				'Sousou no Frieren (2026) poster',
				'Sousou no Frieren (2027) poster',
			]);
			expect(within(group).getAllByText('TV')).toHaveLength(3);
			expect(within(group).getByAltText('Sousou no Frieren poster')).toHaveAttribute(
				'src',
				'https://media.kitsu.app/anime/46474/poster_image/medium-23e1293e41a0b54b6621eb589c3f0d62.jpeg'
			);
			expect(screen.queryByText('Sousou no Frieren: Marumaru no Mahou')).toBeNull();

			// Trakt's six rows keep their place above the anime group.
			const show = screen.getByText("Frieren: Beyond Journey's End");
			expect(
				show.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
			expect(screen.getByTestId('poster-tt22248376')).toBeInTheDocument();

			expect(callsTo(isAnime).map(([url]) => url)).toEqual([
				'/api/search/anime?keyword=frieren',
			]);
		});

		it('opens the anime page of the row clicked', async () => {
			const user = userEvent.setup();
			const { trakt, anime } = served('frieren');
			serve(trakt, anime);

			render(<SearchBar />);
			await typeQuery(user, 'frieren');
			await user.click(await screen.findByText('Sousou no Frieren'));

			expect(push).toHaveBeenCalledWith('/anime/17617');
			expect(screen.queryByRole('group', { name: 'Anime' })).toBeNull();
		});

		it('links an entry search knows only by its MAL id to its MAL page', async () => {
			const user = userEvent.setup();
			const { trakt, anime } = served('bookworm');
			serve(trakt, anime);

			render(<SearchBar />);
			await typeQuery(user, 'bookworm');

			const group = await screen.findByRole('group', { name: 'Anime' });
			expect(screen.getByText('Ascendance of a Bookworm')).toBeInTheDocument();
			expect(within(group).getByText('Special')).toBeInTheDocument();
			await user.click(
				within(group).getByText(
					'Bishoujo Senshi Sailor Moon SuperS Gaiden: Ami-chan no Hatsukoi'
				)
			);
			expect(push).toHaveBeenCalledWith('/anime/mal-1278');
		});

		it('reaches an entry with no IMDb id and drops rows with no page', async () => {
			const user = userEvent.setup();
			const { trakt, anime } = served('dou-po');
			serve(trakt, anime);

			render(<SearchBar />);
			await typeQuery(user, 'dou po');

			const group = await screen.findByRole('group', { name: 'Anime' });
			// Search answers two `anime:mal-null` rows; there is no page for them.
			expect(within(group).queryByText('Dou Po Cangqiong: Nian Fan 2')).toBeNull();
			expect(within(group).getAllByText('ONA')).toHaveLength(2);
			await user.click(within(group).getByText('Dou Po Cangqiong Nian Fan'));
			expect(push).toHaveBeenCalledWith('/anime/17052');
		});

		it('still lists anime when Trakt fails', async () => {
			const user = userEvent.setup();
			vi.spyOn(console, 'error').mockImplementation(() => {});
			serve(new Error('Request failed with status code 502'), served('frieren').anime);

			render(<SearchBar />);
			await typeQuery(user, 'frieren');

			const group = await screen.findByRole('group', { name: 'Anime' });
			expect(within(group).getByText('Sousou no Frieren')).toBeInTheDocument();
			expect(callsTo(isTrakt)).toHaveLength(1);
		});

		it('still lists movies and shows when anime search fails', async () => {
			const user = userEvent.setup();
			vi.spyOn(console, 'error').mockImplementation(() => {});
			serve(served('frieren').trakt, new Error('Request failed with status code 500'));

			render(<SearchBar />);
			await typeQuery(user, 'frieren');

			expect(await screen.findByText("Frieren: Beyond Journey's End")).toBeInTheDocument();
			expect(callsTo(isAnime)).toHaveLength(1);
			expect(screen.queryByRole('group', { name: 'Anime' })).toBeNull();
		});

		it('does not wait for a slow anime search, nor for a slow Trakt', async () => {
			const user = userEvent.setup();
			const { trakt, anime } = served('frieren');
			serve(trakt, 'pending');

			const { unmount } = render(<SearchBar />);
			await typeQuery(user, 'frieren');
			expect(await screen.findByText("Frieren: Beyond Journey's End")).toBeInTheDocument();
			expect(callsTo(isAnime)).toHaveLength(1);
			unmount();

			resetAnimeSuggestions();
			mockedGet.mockReset();
			serve('pending', anime);
			render(<SearchBar />);
			await typeQuery(user, 'frieren');
			const group = await screen.findByRole('group', { name: 'Anime' });
			expect(within(group).getByText('Sousou no Frieren')).toBeInTheDocument();
			expect(callsTo(isTrakt)).toHaveLength(1);
		});

		it('asks anime search once per query and not for two letters', async () => {
			const user = userEvent.setup();
			const { trakt, anime } = served('frieren');
			serve(trakt, anime);

			render(<SearchBar />);
			await typeQuery(user, 'fr');
			await waitFor(() => expect(callsTo(isTrakt)).toHaveLength(1));
			expect(callsTo(isAnime)).toHaveLength(0);

			await typeQuery(user, 'frieren');
			await screen.findByRole('group', { name: 'Anime' });
			await typeQuery(user, 'dune');
			await waitFor(() => expect(callsTo(isAnime)).toHaveLength(2));
			await typeQuery(user, 'Frieren');
			await waitFor(() => expect(callsTo(isTrakt)).toHaveLength(4));
			await screen.findByRole('group', { name: 'Anime' });

			expect(callsTo(isAnime).map(([url]) => url)).toEqual([
				'/api/search/anime?keyword=frieren',
				'/api/search/anime?keyword=dune',
			]);
		});
	});
});
