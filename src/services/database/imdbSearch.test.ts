import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import coverage from './__fixtures__/imdb-coverage-titles.json';
import futurama from './__fixtures__/imdb-futurama-titles.json';
import { ImdbSearchService } from './imdbSearch';

const prismaMock = vi.hoisted(() => ({
	$queryRaw: vi.fn(),
	imdbTitleBasics: {
		findUnique: vi.fn(),
	},
	imdbTitleRatings: {
		findUnique: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('ImdbSearchService', () => {
	let service: ImdbSearchService;

	beforeEach(() => {
		service = new ImdbSearchService();
		(prismaMock.$queryRaw as Mock).mockReset();
		(prismaMock.imdbTitleBasics.findUnique as Mock).mockReset();
		(prismaMock.imdbTitleRatings.findUnique as Mock).mockReset();
	});

	describe('searchTitles', () => {
		it('returns empty array for empty keyword', async () => {
			const results = await service.searchTitles('');
			expect(results).toEqual([]);
			expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
		});

		it('returns empty array for keyword with only special characters', async () => {
			const results = await service.searchTitles('!@#$%');
			expect(results).toEqual([]);
		});

		it('returns results from basics fulltext search', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([
				{
					imdbId: 'tt0111161',
					type: 'movie',
					year: 1994,
					title: 'The Shawshank Redemption',
					originalTitle: 'The Shawshank Redemption',
					rating: 9.3,
					votes: 2500000,
					isOriginalMatch: 1,
				},
			]);

			const results = await service.searchTitles('Shawshank Redemption');

			expect(results).toHaveLength(1);
			expect(results[0].imdbId).toBe('tt0111161');
			expect(results[0].rating).toBe(9.3);
			expect(results[0].isOriginalMatch).toBe(true);
		});

		it('falls back to akas fulltext when basics returns empty', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
				{
					imdbId: 'tt001',
					type: 'movie',
					year: 2000,
					title: 'Foreign Title',
					originalTitle: null,
					rating: 7.0,
					votes: 100,
					isOriginalMatch: 0,
				},
			]);

			const results = await service.searchTitles('Foreign Title');

			expect(results).toHaveLength(1);
			expect(results[0].isOriginalMatch).toBe(false);
			expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
		});

		it('falls back to LIKE search when both fulltext searches fail', async () => {
			prismaMock.$queryRaw
				.mockRejectedValueOnce(new Error('fulltext index missing'))
				.mockRejectedValueOnce(new Error('fulltext index missing'))
				.mockResolvedValueOnce([
					{
						imdbId: 'tt002',
						type: 'show',
						year: 2020,
						title: 'Test Show',
						originalTitle: null,
						rating: null,
						votes: null,
						isOriginalMatch: 1,
					},
				]);

			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const results = await service.searchTitles('Test Show');

			expect(results).toHaveLength(1);
			expect(results[0].title).toBe('Test Show');
			expect(results[0].rating).toBeNull();
			consoleSpy.mockRestore();
		});

		it('falls back to LIKE when both fulltext return empty', async () => {
			prismaMock.$queryRaw
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{
						imdbId: 'tt003',
						type: 'movie',
						year: 2023,
						title: 'Like Result',
						originalTitle: 'Like Result',
						rating: 6.0,
						votes: 50,
						isOriginalMatch: 1,
					},
				]);

			const results = await service.searchTitles('Like Result');

			expect(results).toHaveLength(1);
			expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(3);
		});

		// A zurg-usenet release, 10 Things I Hate About You (1999) Hin-Eng (1080p BluRay 10bit x265
		// CZaRS) [PMZ], searched as "10 things i hate about you movie": "10" is shorter than
		// innodb_ft_min_token_size, so requiring it matched nothing in either fulltext index and
		// the search fell through to the LIKE scan, 47 s on dmmdb (2026-10-19).
		it('leaves words no fulltext index holds optional', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([
				{
					imdbId: 'tt0147800',
					type: 'movie',
					year: 1999,
					title: '10 Things I Hate About You',
					originalTitle: '10 Things I Hate About You',
					rating: 7.4,
					votes: 400000,
					isOriginalMatch: 1,
				},
			]);

			const results = await service.searchTitles('10 things i hate about you', {
				mediaType: 'movie',
			});

			expect(results.map((r) => r.imdbId)).toEqual(['tt0147800']);
			expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
			expect(prismaMock.$queryRaw.mock.calls[0][0].values).toContain(
				'10* +things* +hate* about* +you*'
			);
		});

		// Production searches on 2026-10-29: \w is ASCII only, so these reached
		// the database as "" (nothing searched) and "Am lie".
		it('searches the letters of every script, accents kept', async () => {
			for (const [keyword, against] of [
				['千と千尋の神隠し', '+千と千尋の神隠し*'],
				['Ирония судьбы', '+Ирония* +судьбы*'],
				['दंगल', '+दंगल*'],
				['Amélie', '+Amélie*'],
			]) {
				prismaMock.$queryRaw.mockReset();
				prismaMock.$queryRaw.mockResolvedValue([]);
				await service.searchTitles(keyword);
				expect(prismaMock.$queryRaw.mock.calls[0][0].values).toContain(against);
			}
		});

		it('says which alternative title an akas match came through', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
				{
					imdbId: 'tt0245429',
					type: 'movie',
					year: 2001,
					title: 'Spirited Away',
					originalTitle: 'Sen to Chihiro no kamikakushi',
					rating: 8.6,
					votes: 986000,
					isOriginalMatch: 0,
					matchedTitle: '千と千尋の神隠し',
				},
			]);
			const [result] = await service.searchTitles('千と千尋の神隠し');
			expect(result.matchedTitle).toBe('千と千尋の神隠し');
		});

		it('keeps short words required when nothing else is', () => {
			expect(ImdbSearchService.fulltextKeyword('up')).toBe('+up*');
			expect(ImdbSearchService.fulltextKeyword('24')).toBe('+24*');
			expect(ImdbSearchService.fulltextKeyword('the')).toBeNull();
			expect(ImdbSearchService.fulltextKeyword('up the')).toBe('+up* the*');
		});

		// "20/20" arrives as "20 20": no word is in the fulltext index, so its exact
		// spellings are looked up first (title.integration.test.ts runs them on MySQL).
		it('looks up the exact spellings of a title fulltext cannot hold', async () => {
			const twenty = {
				imdbId: 'tt0124932',
				type: 'show',
				year: 1978,
				title: '20/20',
				originalTitle: '20/20',
				rating: 6.4,
				votes: 1800,
				isOriginalMatch: 1,
			};
			const film2020 = { ...twenty, imdbId: 'tt6727598', type: 'movie', title: '2020' };
			prismaMock.$queryRaw.mockResolvedValueOnce([twenty]).mockResolvedValueOnce([film2020]);

			const results = await service.searchTitles('20 20');

			expect(results.map((r) => r.imdbId)).toEqual(['tt0124932', 'tt6727598']);
			expect(prismaMock.$queryRaw.mock.calls[0][0].values).toEqual(
				expect.arrayContaining(['20/20', '20-20', '2020'])
			);
			expect(ImdbSearchService.exactTitleSpellings('m a s h')).toContain('m*a*s*h');
			expect(ImdbSearchService.fulltextCannotFind('48 hours')).toBe(false);
		});

		it('gives up on a LIKE scan that runs out of time', async () => {
			prismaMock.$queryRaw
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockRejectedValueOnce(
					new Error(
						'Raw query failed. Code: `3024`. Message: `Query execution was interrupted, maximum statement execution time exceeded`'
					)
				);

			const results = await service.searchTitles('xf recyclotransformers nfo');

			expect(results).toEqual([]);
			expect(prismaMock.$queryRaw.mock.calls[2][0].sql).toContain(
				`MAX_EXECUTION_TIME(${ImdbSearchService.LIKE_TIMEOUT_MS})`
			);
		});

		it('skips fulltext for all-stopword queries', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([
				{
					imdbId: 'tt004',
					type: 'movie',
					year: 2020,
					title: 'The',
					originalTitle: 'The',
					rating: 5.0,
					votes: 10,
					isOriginalMatch: 1,
				},
			]);

			const results = await service.searchTitles('the');

			expect(results).toHaveLength(1);
			expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
		});

		it('uses title when originalTitle is null', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([
				{
					imdbId: 'tt005',
					type: 'movie',
					year: 2020,
					title: null,
					originalTitle: 'Original Only',
					rating: null,
					votes: null,
					isOriginalMatch: 1,
				},
			]);

			const results = await service.searchTitles('Original');

			expect(results[0].title).toBe('Original Only');
		});

		it('passes year and mediaType filters', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);

			await service.searchTitles('test', { year: 2020, mediaType: 'movie' });

			expect(prismaMock.$queryRaw).toHaveBeenCalled();
		});

		it('passes limit option', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);

			await service.searchTitles('test', { limit: 10 });

			expect(prismaMock.$queryRaw).toHaveBeenCalled();
		});
	});

	describe('title types', () => {
		type Row = {
			tconst: string;
			titleType: string;
			startYear: number | null;
			numVotes: number | null;
		};

		// "The last two years" is relative to now; pin now to when the rows were captured.
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		/**
		 * Apply the generated query's own type filter and type mapping to real
		 * rows, since the mocked client cannot run the SQL itself.
		 */
		function applyTypeClauses(sql: string, rows: Row[]) {
			const filter = sql.split('\n').find((l) => /^\s*AND .*b\.title_type/.test(l));
			const mapping = sql.match(
				/WHEN b\.title_type (?:= '(\w+)'|IN \(([^)]*)\)) THEN 'movie'/
			);
			if (!filter || !mapping) throw new Error('type clauses not found in:\n' + sql);
			const ratedOnly = /INNER JOIN imdb_title_ratings/.test(sql);
			// The clause is plain SQL over three columns; evaluate it as JS. A null
			// compares false in both, and a missing ratings row has null votes.
			const admits = new Function(
				'type',
				'votes',
				'year',
				'return ' +
					filter
						.trim()
						.replace(/^AND /, '')
						.replace(/b\.title_type IN \(([^)]*)\)/g, '[$1].includes(type)')
						.replace(/b\.title_type = /g, 'type === ')
						.replace(/r\.tconst IS NOT NULL/g, '(votes !== null)')
						.replace(/r\.num_votes/g, 'votes')
						.replace(/b\.start_year/g, 'year')
						.replace(/ AND /g, ' && ')
						.replace(/ OR /g, ' || ')
			) as (type: string, votes: number | null, year: number | null) => boolean;
			const movieTypes = (mapping[1] ?? mapping[2])
				.split(',')
				.map((t) => t.trim().replace(/'/g, ''));
			return rows
				.filter((r) => !ratedOnly || r.numVotes !== null)
				.filter((r) => admits(r.titleType, r.numVotes, r.startYear))
				.map((r) => ({
					imdbId: r.tconst,
					type: movieTypes.includes(r.titleType) ? 'movie' : 'show',
				}));
		}

		const films = [
			{ imdbId: 'tt0471711', type: 'movie' }, // Bender's Big Score
			{ imdbId: 'tt1054485', type: 'movie' }, // The Beast with a Billion Backs
			{ imdbId: 'tt1054486', type: 'movie' }, // Bender's Game
			{ imdbId: 'tt1054487', type: 'movie' }, // Into the Wild Green Yonder
		];

		it('finds direct-to-video films, filed as movies, when no type is given', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);
			await service.searchTitles('futurama');

			const admitted = applyTypeClauses(
				prismaMock.$queryRaw.mock.calls[0][0].sql,
				futurama.rows
			);

			expect(admitted).toEqual(expect.arrayContaining(films));
			expect(admitted).toContainEqual({ imdbId: 'tt0149460', type: 'show' });
			expect(admitted.map((r) => r.imdbId)).not.toContain('tt0377952'); // videoGame
			expect(admitted.map((r) => r.imdbId)).not.toContain('tt1630885'); // tvEpisode
			// A featurette nobody rates stays out: 'Futurama' Returns, 768 votes
			expect(admitted.map((r) => r.imdbId)).not.toContain('tt1230102');
		});

		it('keeps direct-to-video films in a movie-only search', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);
			await service.searchTitles('futurama', { mediaType: 'movie' });

			const admitted = applyTypeClauses(
				prismaMock.$queryRaw.mock.calls[0][0].sql,
				futurama.rows
			);

			expect(admitted).toEqual(expect.arrayContaining(films));
			expect(admitted.every((r) => r.type === 'movie')).toBe(true);
		});

		it('leaves direct-to-video films out of a show-only search', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);
			await service.searchTitles('futurama', { mediaType: 'show' });

			const admitted = applyTypeClauses(
				prismaMock.$queryRaw.mock.calls[0][0].sql,
				futurama.rows
			);

			expect(admitted.map((r) => r.imdbId).sort()).toEqual(['tt0149460', 'tt6090450']);
		});

		const ids = (rows: Array<{ imdbId: string }>) => rows.map((r) => r.imdbId);

		it('finds the titles users streamed that search used to miss', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);
			await service.searchTitles('anything');

			const admitted = applyTypeClauses(
				prismaMock.$queryRaw.mock.calls[0][0].sql,
				coverage.rows
			);

			expect(admitted).toEqual(
				expect.arrayContaining([
					{ imdbId: 'tt0059026', type: 'movie' }, // A Charlie Brown Christmas, tvMovie
					{ imdbId: 'tt0108598', type: 'movie' }, // The Wrong Trousers, short
					{ imdbId: 'tt41368989', type: 'movie' }, // Finding Harry, 2026 special, 985 votes
					{ imdbId: 'tt21357150', type: 'movie' }, // Avengers: Doomsday, unrated, 2026
					{ imdbId: 'tt0372784', type: 'movie' }, // Batman Begins
				])
			);
		});

		it('keeps out featurettes and old unrated placeholders', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);
			await service.searchTitles('anything');

			const admitted = ids(
				applyTypeClauses(prismaMock.$queryRaw.mock.calls[0][0].sql, coverage.rows)
			);

			expect(admitted).not.toContain('tt1006835'); // Beyond Batman ... Batman, 60 votes
			expect(admitted).not.toContain('tt33049792'); // a 2023 Spider-Verse featurette, 20 votes
			expect(admitted).not.toContain('tt0350345'); // Drowning (1995), no ratings row
		});

		it('ranks unrated titles after every rated one', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);
			await service.searchTitles('avengers doomsday');

			expect(prismaMock.$queryRaw.mock.calls[0][0].sql).toMatch(
				/ORDER BY r\.tconst IS NULL, /
			);
		});
	});

	describe('getTitleById', () => {
		it('returns null when title not found', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue(null);

			expect(await service.getTitleById('tt999')).toBeNull();
		});

		it('returns title details with rating', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				tconst: 'tt001',
				titleType: 'movie',
				startYear: 2020,
				primaryTitle: 'Test Movie',
				originalTitle: 'Test Movie Original',
			});
			prismaMock.imdbTitleRatings.findUnique.mockResolvedValue({
				tconst: 'tt001',
				averageRating: 7.5,
				numVotes: 1000,
			});

			const result = await service.getTitleById('tt001');

			expect(result).toEqual({
				imdbId: 'tt001',
				type: 'movie',
				year: 2020,
				title: 'Test Movie',
				originalTitle: 'Test Movie Original',
				rating: 7.5,
				votes: 1000,
				isOriginalMatch: true,
			});
		});

		it('returns null rating when no ratings record', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				tconst: 'tt001',
				titleType: 'tvSeries',
				startYear: 2021,
				primaryTitle: 'Test Show',
				originalTitle: null,
			});
			prismaMock.imdbTitleRatings.findUnique.mockResolvedValue(null);

			const result = await service.getTitleById('tt001');

			expect(result!.type).toBe('show');
			expect(result!.rating).toBeNull();
			expect(result!.votes).toBeNull();
		});

		it('uses originalTitle when primaryTitle is null', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				tconst: 'tt001',
				titleType: 'movie',
				startYear: null,
				primaryTitle: null,
				originalTitle: 'Fallback Title',
			});
			prismaMock.imdbTitleRatings.findUnique.mockResolvedValue(null);

			const result = await service.getTitleById('tt001');

			expect(result!.title).toBe('Fallback Title');
		});
	});

	describe('getTitleType', () => {
		it('returns the raw title type', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({ titleType: 'tvMiniSeries' });

			expect(await service.getTitleType('tt001')).toBe('tvMiniSeries');
		});

		// The distinction getTitleById throws away: it answers 'show' for a
		// tvMovie, which lives on a /movie/tt… page and has no season to file a
		// completed transfer under.
		it('keeps tvMovie distinct from a series', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({ titleType: 'tvMovie' });

			expect(await service.getTitleType('tt001')).toBe('tvMovie');
			expect((await service.getTitleById('tt001'))?.type).toBe('show');
		});

		it('returns null for an id the dump does not carry', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue(null);

			expect(await service.getTitleType('tt404')).toBeNull();
		});
	});
});
