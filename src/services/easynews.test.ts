import {
	checkEasynewsLogin,
	EasynewsAuthError,
	EasynewsNzbError,
	fetchEasynewsNzb,
	isEasynewsPath,
	matchesTarget,
	readCredentials,
	resolveEasynewsLink,
	searchEasynews,
	searchQuery,
	toResults,
} from '@/services/easynews';
import bear from '@/test/fixtures/easynews/search-cocaine-bear-2023-2026-10-25.json';
import got from '@/test/fixtures/easynews/search-game-of-thrones-s03-2026-10-25.json';
import severance from '@/test/fixtures/easynews/search-severance-s02-2026-10-25.json';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Recorded from members.easynews.com on 2026-10-25 and trimmed to the fields DMM
// reads; tokens, signatures and posters were dropped.
const credentials = { username: 'user', password: 'pass' };

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('searchQuery', () => {
	it('adds the year to a film and the season to a show', () => {
		expect(searchQuery({ title: 'Cocaine Bear', year: '2023' })).toBe('Cocaine Bear 2023');
		expect(searchQuery({ title: 'Severance', seasonNum: 2 })).toBe('Severance S02');
	});
});

describe('matchesTarget', () => {
	it('needs the title first, so loose word matches are dropped', () => {
		const target = { title: 'Game of Thrones', seasonNum: 3 };
		expect(matchesTarget('Game.of.Leopard.Thrones.S01E03.GERMAN.DL.DOKU.1080p', target)).toBe(
			false
		);
		expect(
			matchesTarget(
				'Digging.Up.Britains.Past.S02E03.Game.of.Thrones.1080p.MY5.WEB-DL',
				target
			)
		).toBe(false);
		expect(matchesTarget('Game.of.Thrones.S03E04.1080p.BluRay.x264-ROVERS', target)).toBe(true);
	});

	it('keeps a year between the title and the episode', () => {
		expect(
			matchesTarget('severance.2022.s02e10.final.multi.hdr.2160p.web.h265-higgsboson', {
				title: 'Severance',
				seasonNum: 2,
			})
		).toBe(true);
	});

	it('does not take S1 episodes for S10 or the other way round', () => {
		expect(matchesTarget('Show.S10E01.1080p', { title: 'Show', seasonNum: 1 })).toBe(false);
		expect(matchesTarget('Show.S01E10.1080p', { title: 'Show', seasonNum: 10 })).toBe(false);
	});

	it('drops samples however they are spelled', () => {
		const target = { title: 'Severance', seasonNum: 2 };
		expect(
			matchesTarget('severance.2022.s02e01.multi.1080p.web.h264-higgsboson-sample', target)
		).toBe(false);
		expect(
			matchesTarget('severance.s01e02.1080p.bluray.x264-bordure.sample', {
				title: 'Severance',
				seasonNum: 1,
			})
		).toBe(false);
	});

	it('needs the film year when there is one', () => {
		expect(
			matchesTarget('Cocaine.Bear.2023.1080p', { title: 'Cocaine Bear', year: '2023' })
		).toBe(true);
		expect(
			matchesTarget('Cocaine.Bear.2019.1080p', { title: 'Cocaine Bear', year: '2023' })
		).toBe(false);
		expect(
			matchesTarget('Cocaine.Bear.The.True.Story.2023.1080p', {
				title: 'Cocaine Bear',
				year: '2023',
			})
		).toBe(false);
	});

	it('lets a show name its country before the episode', () => {
		expect(
			matchesTarget('The.Office.US.S02E01.1080p', { title: 'The Office', seasonNum: 2 })
		).toBe(true);
	});
});

describe('toResults on recorded searches', () => {
	it('keeps only the film, without samples', () => {
		const results = toResults(bear.data as any, { title: 'Cocaine Bear', year: '2023' });
		expect(results).toHaveLength(96);
		expect(results.every((r) => /^cocaine\Wbear\W+2023/i.test(r.title))).toBe(true);
		expect(results.some((r) => /sample/i.test(r.title))).toBe(false);
		expect(results.some((r) => r.title.startsWith('Blow.The.True.Story.Of.Cocaine'))).toBe(
			false
		);
		// A different 2023 film whose name starts with this one's.
		expect(results.some((r) => r.title.startsWith('Cocaine.Bear.The.True.Story'))).toBe(false);
		expect(results[0]).toEqual({
			path: '682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/Cocaine.Bear.2023.HYBRID.2160p.UHD.Bluray.DV.HDR10REMUX.DTS-HD.MA.7.1-BiTOR.mkv',
			title: 'Cocaine.Bear.2023.HYBRID.2160p.UHD.Bluray.DV.HDR10REMUX.DTS-HD.MA.7.1-BiTOR',
			size: 47589897340,
		});
		expect(results.every((r) => isEasynewsPath(r.path))).toBe(true);
	});

	it('keeps only that season’s episodes of that show', () => {
		const results = toResults(severance.data as any, { title: 'Severance', seasonNum: 2 });
		// Easynews held six full S02 episodes that day; the rest of the 149 hits
		// were samples, S01, or other shows with "Sever" in an episode name.
		expect(results.map((r) => r.title)).toEqual([
			'severance.2022.s02e10.final.multi.hdr.2160p.web.h265-higgsboson',
			'severance.2022.s02e01.multi.dv.2160p.web.h265-higgsboson',
			'severance.2022.s02e05.multi.2160p.web.h265-higgsboson',
			'Severance.S02E03.iTALiAN.1080p.WEB.H264-NEUROSiS',
			'severance.s02e04.1080p.web.h264-successfulcrab',
			'Severance.S02E01.iTALiAN.1080p.WEB.H264-NEUROSiS',
		]);
	});

	it('finds nothing when Easynews holds only samples of a season', () => {
		expect(toResults(got.data as any, { title: 'Game of Thrones', seasonNum: 3 })).toEqual([]);
	});
});

describe('readCredentials', () => {
	it('needs both fields as strings', () => {
		expect(readCredentials({ username: ' u ', password: 'p' })).toEqual({
			username: 'u',
			password: 'p',
		});
		expect(readCredentials({ username: 'u' })).toBeNull();
		expect(readCredentials({ username: 'u', password: 1 })).toBeNull();
		expect(readCredentials(undefined)).toBeNull();
	});
});

describe('isEasynewsPath', () => {
	it('refuses anything that could leave the download folder', () => {
		expect(isEasynewsPath('682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/A.mkv')).toBe(
			true
		);
		expect(isEasynewsPath('../../2.0/api/x')).toBe(false);
		expect(isEasynewsPath('682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/a/b.mkv')).toBe(
			false
		);
		expect(isEasynewsPath('682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/A.mkv?x=1')).toBe(
			false
		);
	});
});

describe('searchEasynews', () => {
	it('sends the login as Basic auth and filters the answer', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(bear)));
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchEasynews(credentials, { title: 'Cocaine Bear', year: '2023' });

		const [url, init] = fetchMock.mock.calls[0];
		expect(new URL(url).searchParams.get('gps')).toBe('Cocaine Bear 2023');
		expect(init.headers.Authorization).toBe(
			`Basic ${Buffer.from('user:pass').toString('base64')}`
		);
		expect(results).toHaveLength(96);
	});

	it('tells a refused login apart from an outage', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
		await expect(searchEasynews(credentials, { title: 'X' })).rejects.toBeInstanceOf(
			EasynewsAuthError
		);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
		await expect(searchEasynews(credentials, { title: 'X' })).rejects.toThrow('HTTP 503');
	});
});

describe('resolveEasynewsLink', () => {
	const path = '682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/Cocaine.Bear.2023.mkv';

	it('returns the signed link Easynews redirects to', async () => {
		const signed = 'https://ams-dl-01.easynews.com:443/dl/TOKEN/Cocaine.Bear.2023.mkv';
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 302, headers: { Location: signed } }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(resolveEasynewsLink(credentials, path)).resolves.toBe(
			'https://ams-dl-01.easynews.com/dl/TOKEN/Cocaine.Bear.2023.mkv'
		);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`https://members.easynews.com/dl/auto/443/${path}`);
		expect(init.redirect).toBe('manual');
	});

	it('refuses a redirect off easynews.com', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(null, {
					status: 302,
					headers: { Location: 'https://evil.example/x' },
				})
			)
		);
		await expect(resolveEasynewsLink(credentials, path)).rejects.toThrow(
			'outside easynews.com'
		);
	});

	it('reports a refused login', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
		await expect(resolveEasynewsLink(credentials, path)).rejects.toBeInstanceOf(
			EasynewsAuthError
		);
	});
});

describe('checkEasynewsLogin', () => {
	it('reads the members page with the login, and tells 401 from an outage', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(checkEasynewsLogin(credentials)).resolves.toBeUndefined();
		expect(fetchMock.mock.calls[0][0]).toBe('https://members.easynews.com/');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
			`Basic ${Buffer.from('user:pass').toString('base64')}`
		);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
		await expect(checkEasynewsLogin(credentials)).rejects.toBeInstanceOf(EasynewsAuthError);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
		await expect(checkEasynewsLogin(credentials)).rejects.toThrow('HTTP 503');
	});
});

describe('toResults keeps the sig', () => {
	// Real search rows carry a 143-character `sig` (2026-11-07), which dl-nzb needs back.
	it("passes each row's sig on with its result", () => {
		const sig = 'S'.repeat(143);
		const [first] = toResults([{ ...bear.data[0], sig }] as any, {
			title: 'Cocaine Bear',
			year: '2023',
		});
		expect(first.sig).toBe(sig);
	});
});

describe('fetchEasynewsNzb', () => {
	// The head of a real dl-nzb answer: 3 of its 175 files, 3 segments each.
	const nzb = readFileSync(
		path.resolve(
			__dirname,
			'../test/fixtures/easynews/dl-nzb-oppenheimer-2023-head-2026-11-07.nzb'
		),
		'latin1'
	);
	const NAME = 'Oppenheimer 2023 2160p BluRay Remux DV HDR10+ DTS-HD MA 5.1 HEVC-tarunk9c';
	const PATH = `9e26b9f3327b7175604928437b0766cf04ea695054e26.mkv/${NAME}.mkv`;
	// What dl-nzb answered for the same file with a wrong sig, byte for byte.
	const EMPTY =
		'<?xml version="1.0" encoding="iso-8859-1"?>\n<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 0.9//EN" "http://www.newzbin.com/DTD/nzb/nzb-0.9.dtd">\n<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"/>\n';
	const nzbResponse = (body: string) =>
		new Response(body, { headers: { 'Content-Type': 'text/nzb; charset=UTF-8' } });

	it('posts the hash, name and extension under the sig as the web app does', async () => {
		const fetchMock = vi.fn().mockResolvedValue(nzbResponse(nzb));
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchEasynewsNzb(credentials, PATH, 'a/b+c=')).resolves.toBe(nzb);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://members.easynews.com/2.0/api/dl-nzb');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe(
			`Basic ${Buffer.from('user:pass').toString('base64')}`
		);
		expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
		const b64 = (s: string) => Buffer.from(s).toString('base64');
		// The field name is percent-encoded whole, which is what Easynews took.
		expect(init.body).toMatch(/^autoNZB=1&0%26sig%3Da%2Fb%2Bc%3D=/);
		expect([...new URLSearchParams(init.body)]).toEqual([
			['autoNZB', '1'],
			[
				'0&sig=a/b+c=',
				`9e26b9f3327b7175604928437b0766cf04ea695054e26|${b64(NAME)}:${b64('.mkv')}`,
			],
		]);
	});

	it('refuses the empty NZB Easynews answers without a valid sig', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nzbResponse(EMPTY)));
		const sent = fetchEasynewsNzb(credentials, PATH, 'x');
		await expect(sent).rejects.toBeInstanceOf(EasynewsNzbError);
		await expect(sent).rejects.toThrow('Easynews did not hand out this NZB; search again');
	});

	it('names a refused login and refuses an NZB over the cap', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
		await expect(fetchEasynewsNzb(credentials, PATH, 'x')).rejects.toBeInstanceOf(
			EasynewsAuthError
		);
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(nzb, { headers: { 'Content-Length': String(33 * 1024 * 1024) } })
				)
		);
		await expect(fetchEasynewsNzb(credentials, PATH, 'x')).rejects.toThrow('too large');
	});
});
