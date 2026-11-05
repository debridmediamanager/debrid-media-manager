import adFiles from '@/test/fixtures/libraryAvailability/adfiles.json';
import adStatus from '@/test/fixtures/libraryAvailability/adstatus.json';
import dlTv from '@/test/fixtures/libraryAvailability/dl_tv.json';
import musicFiles from '@/test/fixtures/libraryAvailability/music_files.json';
import musicStatus from '@/test/fixtures/libraryAvailability/music_status.json';
import rdMovie from '@/test/fixtures/libraryAvailability/rdinfo_movie.json';
import rdTv from '@/test/fixtures/libraryAvailability/rdinfo_tv.json';
import { UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it, vi } from 'vitest';
import {
	cachedOn,
	reportLibraryAvailability,
	type LibraryItem,
	type ReportDeps,
} from './libraryAvailability';

// real responses (testacct123 and the AllDebrid test account, 2026-11-05), download links redacted
const rdItem = (info: typeof rdMovie, status = info.status): LibraryItem => ({
	id: `rd:${info.id}`,
	hash: info.hash,
	serviceStatus: status,
});
const adItem: LibraryItem = {
	id: `ad:${adStatus.id}`,
	hash: adStatus.hash,
	serviceStatus: `${adStatus.statusCode}`,
	adData: adStatus as any,
};
const named = (imdbId: string) => ({ imdbId, title: 'x', year: 2026, kind: 'movie' as const });

function deps(recorded: string[] = []): ReportDeps {
	const infos: Record<string, unknown> = { [rdMovie.id]: rdMovie, [rdTv.id]: rdTv };
	const check = vi.fn(async (_k: string, _s: string, hashes: string[]) => ({
		available: hashes.filter((h) => recorded.includes(h)).map((hash) => ({ hash })),
	}));
	return {
		rdInfo: vi.fn(async (_key: string, id: string) => {
			if (!infos[id]) throw new Error('404');
			return infos[id];
		}) as any,
		adFiles: vi.fn(async () => adFiles.data) as any,
		rdRecorded: check as any,
		adRecorded: check as any,
		rdSubmit: vi.fn(async () => ({ success: true })) as any,
		adSubmit: vi.fn(async () => ({ success: true })) as any,
		dlTorrent: vi.fn(async () => dlTv) as any,
		dlRecorded: check as any,
		dlRecord: vi.fn(async () => true) as any,
		token: vi.fn(async () => ['key', 'solution'] as [string, string]),
		wait: vi.fn(async () => undefined),
	};
}

describe('cachedOn', () => {
	it('takes finished RD torrents and Ready AD magnets only', () => {
		expect(cachedOn(rdItem(rdMovie))).toBe('rd');
		expect(cachedOn(rdItem(rdMovie, 'downloading'))).toBeNull();
		expect(cachedOn(adItem)).toBe('ad');
		expect(cachedOn({ ...adItem, serviceStatus: '1' })).toBeNull();
		expect(cachedOn({ ...rdItem(rdMovie), id: `tb:1` })).toBeNull();
		expect(cachedOn({ ...rdItem(rdMovie), hash: 'Magnet' })).toBeNull();
	});
});

describe('reportLibraryAvailability', () => {
	it('records each named, cached RD release DMM has no row for, from its torrent info', async () => {
		const d = deps([rdTv.hash]);
		const unnamed = { ...rdItem(rdMovie), id: 'rd:UNNAMED', hash: 'a'.repeat(40) };
		await reportLibraryAvailability(
			[rdItem(rdMovie), rdItem(rdTv), unnamed],
			{ [`rd:${rdMovie.id}`]: named('tt28363783'), [`rd:${rdTv.id}`]: named('tt5626028') },
			{ rd: 'rdkey' },
			d
		);
		// the TV pack already has a row: never asked about again, never rewritten
		expect(d.rdInfo).toHaveBeenCalledTimes(1);
		expect(d.rdInfo).toHaveBeenCalledWith('rdkey', rdMovie.id);
		expect(d.rdSubmit).toHaveBeenCalledWith('key', 'solution', rdMovie, 'tt28363783');
	});

	it('records a Ready AD magnet with its files flattened to full paths', async () => {
		const d = deps();
		await reportLibraryAvailability(
			[adItem],
			{ [adItem.id]: named('tt0000001') },
			{ ad: 'adkey' },
			d
		);
		expect(d.adFiles).toHaveBeenCalledWith('adkey', [adStatus.id]);
		const sent = (d.adSubmit as any).mock.calls[0][2];
		expect(sent).toMatchObject({
			hash: adStatus.hash,
			imdbId: 'tt0000001',
			filename: adStatus.filename,
			size: adStatus.size,
			status: 'Ready',
			statusCode: 4,
			completionDate: adStatus.completionDate,
		});
		expect(sent.files).toHaveLength(3);
		expect(sent.files[1].n).toBe(
			`${adStatus.filename}/The.Breadwinner.2026.MULTi.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.HEVC-KiT.mkv`
		);
	});

	it('sends nothing without a key, an IMDb id or a finished download', async () => {
		const d = deps();
		await reportLibraryAvailability(
			[rdItem(rdMovie), adItem, rdItem(rdTv, 'downloading')],
			{
				[`rd:${rdMovie.id}`]: named('tt28363783'),
				[adItem.id]: named('not-an-imdb-id'),
				[`rd:${rdTv.id}`]: named('tt5626028'),
			},
			{ ad: 'adkey' },
			d
		);
		expect(d.rdInfo).not.toHaveBeenCalled();
		expect(d.adFiles).not.toHaveBeenCalled();
	});

	it('goes on past a release RD no longer answers for', async () => {
		const d = deps();
		const gone = { ...rdItem(rdTv), id: 'rd:GONE', hash: 'b'.repeat(40) };
		await reportLibraryAvailability(
			[gone, rdItem(rdMovie)],
			{ 'rd:GONE': named('tt1'), [`rd:${rdMovie.id}`]: named('tt28363783') },
			{ rd: 'rdkey' },
			d
		);
		expect(d.rdSubmit).toHaveBeenCalledTimes(1);
		expect(d.rdSubmit).toHaveBeenCalledWith('key', 'solution', rdMovie, 'tt28363783');
	});

	it('leaves out a release that is mostly not video, whatever title its name was given', async () => {
		// AD's "music" folder was named "Music (2021)" on 2026-11-05: 104 GB of audio and one bonus
		// .mpg, trimmed to the .mpg and audio twenty times its size
		const music: LibraryItem = {
			id: `ad:${musicStatus.id}`,
			hash: musicStatus.hash,
			serviceStatus: '4',
			adData: musicStatus as any,
		};
		const d = deps();
		d.adFiles = vi.fn(async () => musicFiles.data) as any;
		const audioOnly = {
			...rdMovie,
			files: rdMovie.files.map((f) => ({ ...f, path: '/Album/01 Track.flac' })),
		};
		d.rdInfo = vi.fn(async () => audioOnly) as any;
		await reportLibraryAvailability(
			[music, rdItem(rdMovie)],
			{ [music.id]: named('tt7541720'), [`rd:${rdMovie.id}`]: named('tt7541720') },
			{ rd: 'rdkey', ad: 'adkey' },
			d
		);
		expect(d.adFiles).toHaveBeenCalled();
		expect(d.adSubmit).not.toHaveBeenCalled();
		expect(d.rdSubmit).not.toHaveBeenCalled();
		// pacing holds for a skipped release too
		expect(d.wait).toHaveBeenCalledTimes(1);
	});

	it('records AD without waiting for the paced RD run', async () => {
		// in a library with both, AD went unchecked for the two minutes RD took (2026-11-05)
		const d = deps();
		let adDone!: () => void;
		const adSent = new Promise<void>((resolve) => (adDone = resolve));
		d.adSubmit = vi.fn(async () => (adDone(), { success: true })) as any;
		d.rdInfo = vi.fn(async () => (await adSent, rdMovie)) as any;
		await reportLibraryAvailability(
			[rdItem(rdMovie), adItem],
			{ [`rd:${rdMovie.id}`]: named('tt28363783'), [adItem.id]: named('tt0000001') },
			{ rd: 'rdkey', ad: 'adkey' },
			d
		);
		expect(d.adSubmit).toHaveBeenCalledTimes(1);
		expect(d.rdSubmit).toHaveBeenCalledTimes(1);
	}, 1000);

	it('records a finished Debrid-Link release from its own fetch, which expands a ZIP', async () => {
		const d = deps();
		const finished: LibraryItem = {
			id: `dl:${dlTv.id}`,
			hash: dlTv.hashString,
			serviceStatus: '100',
			status: UserTorrentStatus.finished,
		};
		const downloading: LibraryItem = {
			...finished,
			id: 'dl:other',
			hash: 'c'.repeat(40),
			status: UserTorrentStatus.downloading,
		};
		await reportLibraryAvailability(
			[finished, downloading],
			{ [finished.id]: named('tt0108778'), 'dl:other': named('tt0108778') },
			{ dl: 'dlkey' },
			d
		);
		expect(d.dlTorrent).toHaveBeenCalledTimes(1);
		expect(d.dlTorrent).toHaveBeenCalledWith('dlkey', dlTv.id);
		expect(d.dlRecord).toHaveBeenCalledWith(
			'tt0108778',
			dlTv.hashString,
			dlTv.name,
			dlTv.files
		);
	});
});
