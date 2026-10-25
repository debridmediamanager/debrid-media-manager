import Database from 'better-sqlite3';

export interface ArrWanted {
	imdbId: string;
	kind: 'movie' | 'show';
	title: string;
	/** Shows: the regular seasons with an episode Sonarr is still looking for. */
	seasons: number[] | null;
}

export interface ArrBackupWanted {
	app: 'radarr' | 'sonarr';
	wanted: ArrWanted[];
	/** Titles the arr is looking for that have no IMDb id, which DMM keys everything on. */
	noImdbId: number;
	/** Films Radarr would not search yet: not released as far as its minimum availability asks. */
	notAvailable: number;
}

const IMDB_ID = /^tt\d{7,}$/;

/**
 * What a Radarr or Sonarr database (the `.db` inside its backup zip) is searching
 * for: monitored films without a file that have reached their minimum
 * availability, and monitored episodes without a file that have aired, in
 * monitored shows. Specials (season 0) are left out, as the wanted list's are.
 * Null when the file is neither app's database.
 */
export function readArrWanted(path: string, now = new Date()): ArrBackupWanted | null {
	const db = new Database(path, { readonly: true, fileMustExist: true });
	try {
		const tables = new Set(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map((r: any) => r.name as string)
		);
		if (tables.has('Movies') && tables.has('MovieMetadata')) return radarr(db);
		if (tables.has('Series') && tables.has('Episodes')) return sonarr(db, now);
		return null;
	} finally {
		db.close();
	}
}

function radarr(db: Database.Database): ArrBackupWanted {
	// Status and MinimumAvailability share Radarr's MovieStatusType: 1 announced, 2 in cinemas, 3 released
	const rows = db
		.prepare(
			`SELECT mm.ImdbId AS imdbId, mm.Title AS title, mm.Status >= m.MinimumAvailability AS available
			FROM Movies m JOIN MovieMetadata mm ON mm.Id = m.MovieMetadataId
			WHERE m.Monitored = 1 AND m.MovieFileId = 0
			ORDER BY m.Added DESC`
		)
		.all() as { imdbId: string | null; title: string; available: number }[];
	const out: ArrBackupWanted = { app: 'radarr', wanted: [], noImdbId: 0, notAvailable: 0 };
	const seen = new Set<string>();
	for (const row of rows) {
		if (!row.available) out.notAvailable++;
		else if (!IMDB_ID.test(row.imdbId ?? '')) out.noImdbId++;
		else if (!seen.has(row.imdbId!)) {
			seen.add(row.imdbId!);
			out.wanted.push({
				imdbId: row.imdbId!,
				kind: 'movie',
				title: row.title,
				seasons: null,
			});
		}
	}
	return out;
}

function sonarr(db: Database.Database, now: Date): ArrBackupWanted {
	const rows = db
		.prepare(
			`SELECT s.ImdbId AS imdbId, s.Title AS title, e.SeasonNumber AS season
			FROM Episodes e JOIN Series s ON s.Id = e.SeriesId
			WHERE s.Monitored = 1 AND e.Monitored = 1 AND COALESCE(e.EpisodeFileId, 0) = 0
				AND e.SeasonNumber > 0 AND julianday(e.AirDateUtc) <= julianday(?)
			GROUP BY s.Id, e.SeasonNumber
			ORDER BY s.Added DESC, e.SeasonNumber`
		)
		.all(now.toISOString()) as { imdbId: string | null; title: string; season: number }[];
	const out: ArrBackupWanted = { app: 'sonarr', wanted: [], noImdbId: 0, notAvailable: 0 };
	const shows = new Map<string, ArrWanted>();
	const noImdb = new Set<string>();
	for (const row of rows) {
		if (!IMDB_ID.test(row.imdbId ?? '')) {
			noImdb.add(row.title);
			continue;
		}
		const show = shows.get(row.imdbId!);
		if (show) show.seasons!.push(row.season);
		else
			shows.set(row.imdbId!, {
				imdbId: row.imdbId!,
				kind: 'show',
				title: row.title,
				seasons: [row.season],
			});
	}
	out.wanted = [...shows.values()];
	out.noImdbId = noImdb.size;
	return out;
}
