import { fetchEasynewsNzb } from '@/services/easynews';
import {
	listedSeason,
	saveEasynewsNzb,
	saveEasynewsNzbInBackground,
} from '@/services/easynewsNzbLibrary';
import { isStoreConfigured, putStoredNzb } from '@/services/newznab/store';
import { repository } from '@/services/repository';
import { setBlocklistForTests } from '@/services/takedown/blocklist';
import { normalizeReleaseName } from '@/utils/takedownParse';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/easynews', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/easynews')>()),
	fetchEasynewsNzb: vi.fn(),
}));
vi.mock('@/services/newznab/store', () => ({
	putStoredNzb: vi.fn(),
	isStoreConfigured: vi.fn(),
}));

// The head of a real dl-nzb answer, captured 2026-11-07: posters, dates and groups
// that name the post, which the stored copy must not keep.
const NZB = readFileSync(
	path.resolve(
		__dirname,
		'../test/fixtures/easynews/dl-nzb-oppenheimer-2023-head-2026-11-07.nzb'
	),
	'latin1'
);
const HASH = '9e26b9f3327b7175604928437b0766cf04ea695054e26';
const FILM = 'Oppenheimer 2023 2160p BluRay Remux DV HDR10+ DTS-HD MA 5.1 HEVC-tarunk9c';
const EPISODE = 'severance.2022.s02e05.multi.1080p.web.h264-higgsboson';
const login = { username: 'user', password: 'pass' };
const SIG = 'S'.repeat(143);
const film = { imdbId: 'tt15398776', kind: 'movie' as const, size: 91459209764 };
const show = { imdbId: 'tt11280740', kind: 'show' as const, size: 2 };

beforeEach(() => {
	vi.mocked(fetchEasynewsNzb).mockResolvedValue(NZB);
	vi.mocked(isStoreConfigured).mockReturnValue(true);
	vi.mocked(putStoredNzb).mockResolvedValue(true as never);
	repository.addEasynewsNzb = vi.fn().mockResolvedValue(undefined);
	repository.getEasynewsNzbs = vi.fn().mockResolvedValue([]);
});
afterEach(() => {
	vi.clearAllMocks();
	setBlocklistForTests([]);
});

describe('listedSeason', () => {
	it('files a film under no season, an episode under its own, and a bare show file nowhere', () => {
		expect(listedSeason('movie', `${FILM}.mkv`)).toBeUndefined();
		expect(listedSeason('show', `${EPISODE}.mkv`)).toBe(2);
		expect(listedSeason('show', 'Severance.Complete.mkv')).toBeNull();
	});
});

describe('saveEasynewsNzb', () => {
	it('stores the anonymized NZB under en and lists it with the title', async () => {
		await expect(saveEasynewsNzb(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film)).resolves.toBe(
			'saved'
		);

		expect(fetchEasynewsNzb).toHaveBeenCalledWith(login, `${HASH}.mkv/${FILM}.mkv`, SIG);
		const [prefix, nativeId, xml] = vi.mocked(putStoredNzb).mock.calls[0];
		expect([prefix, nativeId]).toEqual(['en', HASH]);
		expect(xml).not.toMatch(/poster=|date=/);
		expect(xml).toContain('01d1ff232a0648ee96640f13d937b273@YWx0aHVi');
		expect(repository.addEasynewsNzb).toHaveBeenCalledWith('tt15398776', undefined, {
			id: `en:${HASH}`,
			title: FILM,
			size: 91459209764,
		});
	});

	it('lists an episode under its season', async () => {
		await saveEasynewsNzb(login, `${HASH}.mkv/${EPISODE}.mkv`, SIG, show);
		expect(repository.addEasynewsNzb).toHaveBeenCalledWith('tt11280740', 2, {
			id: `en:${HASH}`,
			title: EPISODE,
			size: 2,
		});
	});

	it('keeps nothing of a taken-down release, and lists nothing it could not store', async () => {
		setBlocklistForTests([], [normalizeReleaseName(FILM)]);
		await expect(saveEasynewsNzb(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film)).resolves.toBe(
			'blocked'
		);
		expect(putStoredNzb).not.toHaveBeenCalled();

		setBlocklistForTests([]);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(putStoredNzb).mockRejectedValueOnce(new Error('B2 503'));
		await expect(saveEasynewsNzb(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film)).resolves.toBe(
			'unstored'
		);
		expect(repository.addEasynewsNzb).not.toHaveBeenCalled();
	});
});

describe('saveEasynewsNzbInBackground', () => {
	it('saves a release once, however many clicks come in while it runs', async () => {
		const first = saveEasynewsNzbInBackground(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film);
		const second = saveEasynewsNzbInBackground(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film);
		await Promise.all([first, second]);
		expect(fetchEasynewsNzb).toHaveBeenCalledTimes(1);
		expect(repository.getEasynewsNzbs).toHaveBeenCalledWith('tt15398776', undefined);
		expect(putStoredNzb).toHaveBeenCalledTimes(1);
	});

	it('does not fetch a release already listed, nor a show file it could not list', async () => {
		repository.getEasynewsNzbs = vi
			.fn()
			.mockResolvedValue([{ id: `en:${HASH}`, title: FILM, size: 1 }]);
		await saveEasynewsNzbInBackground(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film);
		await saveEasynewsNzbInBackground(login, `${HASH}.mkv/Severance.Complete.mkv`, SIG, show);
		expect(fetchEasynewsNzb).not.toHaveBeenCalled();
	});

	it('swallows a failure, so the click it rides on never sees it', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(fetchEasynewsNzb).mockRejectedValueOnce(
			new Error('Easynews NZB failed: HTTP 503')
		);
		await expect(
			saveEasynewsNzbInBackground(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film)
		).resolves.toBeUndefined();
		expect(logged).toHaveBeenCalledWith(
			'Easynews NZB save failed:',
			'Easynews NZB failed: HTTP 503'
		);
		// and the release can be tried again on the next click
		await saveEasynewsNzbInBackground(login, `${HASH}.mkv/${FILM}.mkv`, SIG, film);
		expect(fetchEasynewsNzb).toHaveBeenCalledTimes(2);
	});
});
