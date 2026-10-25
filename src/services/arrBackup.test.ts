// @vitest-environment node
import { deflatedZipMember } from '@/utils/zipEntry';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { readArrWanted } from './arrBackup';

// Backups of fun's Radarr 6.4.4 and Sonarr 5.0 (2026-10-24), cut down to a few
// films and shows and the two tables each read, ApiKey redacted.
const RADARR = join(__dirname, '__fixtures__/radarr_backup_v6.4.4.10685_2026.10.24_17.34.40.zip');
const SONARR = join(__dirname, '__fixtures__/sonarr_backup_v5.0.0.2569_2026.10.24_17.35.41.zip');
const BACKUP_TIME = new Date('2026-10-24T17:35:41Z');

const dir = mkdtempSync(join(tmpdir(), 'arr-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** What the wanted page uploads, inflated as the import endpoint does. */
async function databaseOf(zip: string): Promise<string> {
	const { name, data } = await deflatedZipMember(new Blob([readFileSync(zip)]), (n) =>
		n.endsWith('.db')
	);
	const path = join(dir, name);
	writeFileSync(path, inflateRawSync(Buffer.from(await data.arrayBuffer())));
	return path;
}

describe('readArrWanted', () => {
	it('takes the monitored films Radarr has no file for and would search', async () => {
		expect(readArrWanted(await databaseOf(RADARR), BACKUP_TIME)).toEqual({
			app: 'radarr',
			wanted: [
				{ imdbId: 'tt0014872', kind: 'movie', title: "Entr'acte", seasons: null },
				{ imdbId: 'tt0008907', kind: 'movie', title: 'The Bond', seasons: null },
			],
			// Ang Happy Homes ni Diane Hilario: TMDB only
			noImdbId: 1,
			// Moneyslapper is announced and The Odyssey in cinemas, both wanting "released"
			notAvailable: 2,
		});
	});

	it('takes the seasons with aired episodes Sonarr is still missing', async () => {
		expect(readArrWanted(await databaseOf(SONARR), BACKUP_TIME)).toEqual({
			app: 'sonarr',
			wanted: [
				// Season 0 is missing too, and left out
				{ imdbId: 'tt0328738', kind: 'show', title: 'Fruits Basket', seasons: [1] },
				{ imdbId: 'tt8253044', kind: 'show', title: 'Hinamatsuri', seasons: [1] },
			],
			noImdbId: 0,
			notAvailable: 0,
		});
	});

	it('leaves out episodes that had not aired yet', async () => {
		const result = readArrWanted(await databaseOf(SONARR), new Date('2018-01-01T00:00:00Z'));
		// Hinamatsuri started airing in April 2018
		expect(result?.wanted.map((w) => w.title)).toEqual(['Fruits Basket']);
	});

	it('answers null for a database that is neither app', () => {
		const path = join(dir, 'other.db');
		writeFileSync(path, '');
		expect(readArrWanted(path)).toBeNull();
	});
});

describe('deflatedZipMember', () => {
	it('refuses a file that is not a zip', async () => {
		await expect(deflatedZipMember(new Blob(['not a zip']), () => true)).rejects.toThrow(
			'not a zip'
		);
	});

	it('says so when nothing matches', async () => {
		await expect(
			deflatedZipMember(new Blob([readFileSync(RADARR)]), (n) => n === 'sonarr.db')
		).rejects.toThrow('No matching file');
	});
});
