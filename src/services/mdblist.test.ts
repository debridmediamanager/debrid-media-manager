import { describe, expect, it } from 'vitest';
import type { MList, MListItem, MMovie, MRating, MSearchResponse, MShow } from './mdblist';

describe('MDBList types', () => {
	it('MList type has expected shape', () => {
		const list: MList = {
			id: 1,
			name: 'Top Movies',
			slug: 'top-movies',
			items: 100,
			likes: 50,
			user_id: 42,
			mediatype: 'movie',
			user_name: 'testuser',
			description: 'A list of top movies',
		};

		expect(list.id).toBe(1);
		expect(list.name).toBe('Top Movies');
		expect(list.slug).toBe('top-movies');
		expect(list.items).toBe(100);
		expect(list.likes).toBe(50);
		expect(list.user_id).toBe(42);
		expect(list.mediatype).toBe('movie');
		expect(list.user_name).toBe('testuser');
		expect(list.description).toBe('A list of top movies');
	});

	it('MListItem type has expected shape', () => {
		const item: MListItem = {
			id: 1,
			rank: 1,
			adult: 0,
			title: 'Inception',
			imdb_id: 'tt1375666',
			mediatype: 'movie',
			release_year: 2010,
			language: 'en',
			spoken_language: 'en',
		};

		expect(item.imdb_id).toBe('tt1375666');
		expect(item.release_year).toBe(2010);
		expect(item.adult).toBe(0);
	});

	it('MRating type supports nullable fields', () => {
		const rating: MRating = {
			source: 'imdb',
			value: 8.8,
			score: 88,
			votes: 2000000,
			url: 'https://imdb.com/title/tt1375666',
			popular: 5,
			id: 'tt1375666',
		};

		expect(rating.source).toBe('imdb');
		expect(rating.value).toBe(8.8);

		const nullRating: MRating = {
			source: 'metacritic',
			value: null,
			score: null,
			votes: null,
		};

		expect(nullRating.value).toBeNull();
		expect(nullRating.score).toBeNull();
		expect(nullRating.votes).toBeNull();
		expect(nullRating.url).toBeUndefined();
		expect(nullRating.id).toBeUndefined();
	});

	it('MMovie type has expected shape', () => {
		const movie: MMovie = {
			title: 'Inception',
			year: 2010,
			released: '2010-07-16',
			description: 'A thief who steals corporate secrets...',
			runtime: 148,
			score: 88,
			score_average: 85,
			imdbid: 'tt1375666',
			traktid: 16662,
			tmdbid: 27205,
			type: 'movie',
			ratings: [],
			streams: [],
			watch_providers: [],
			reviews: [],
			keywords: [],
			language: 'en',
			spoken_language: 'en',
			country: 'US',
			certification: 'PG-13',
			commonsense: null,
			age_rating: 13,
			status: 'Released',
			trailer: 'https://youtube.com/watch?v=example',
			poster: 'https://image.tmdb.org/poster.jpg',
			backdrop: 'https://image.tmdb.org/backdrop.jpg',
			response: true,
			apiused: 1,
		};

		expect(movie.imdbid).toBe('tt1375666');
		expect(movie.commonsense).toBeNull();
		expect(movie.response).toBe(true);
	});

	it('MShow type extends movie shape with TV-specific fields', () => {
		const show: MShow = {
			title: 'Breaking Bad',
			year: 2008,
			released: '2008-01-20',
			description: 'A chemistry teacher diagnosed with cancer...',
			runtime: 49,
			score: 96,
			score_average: 94,
			imdbid: 'tt0903747',
			traktid: 1388,
			tmdbid: 1396,
			type: 'show',
			ratings: [],
			streams: [],
			watch_providers: [],
			reviews: [],
			keywords: [],
			language: 'en',
			spoken_language: 'en',
			country: 'US',
			certification: 'TV-MA',
			commonsense: 15,
			age_rating: 17,
			status: 'Ended',
			trailer: 'https://youtube.com/watch?v=example2',
			poster: 'https://image.tmdb.org/poster2.jpg',
			backdrop: 'https://image.tmdb.org/backdrop2.jpg',
			response: true,
			apiused: 1,
			tvdbid: 81189,
			seasons: [{ season_number: 1 }, { season_number: 2 }],
		};

		expect(show.tvdbid).toBe(81189);
		expect(show.seasons).toHaveLength(2);
		expect(show.commonsense).toBe(15);
	});

	it('MSearchResponse type has expected shape', () => {
		const response: MSearchResponse = {
			search: [{ title: 'Inception' }],
			total: 1,
			response: true,
		};

		expect(response.total).toBe(1);
		expect(response.response).toBe(true);
		expect(response.search).toHaveLength(1);

		const emptyResponse: MSearchResponse = {
			search: [],
			total: 0,
			response: false,
		};

		expect(emptyResponse.total).toBe(0);
		expect(emptyResponse.response).toBe(false);
	});
});
