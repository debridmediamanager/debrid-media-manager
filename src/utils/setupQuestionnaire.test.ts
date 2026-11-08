import { describe, expect, it } from 'vitest';
import { recommendSetup, type SetupAnswers } from './setupQuestionnaire';

const answers = (overrides: Partial<SetupAnswers> = {}): SetupAnswers => ({
	player: 'stremio',
	sources: ['real-debrid'],
	host: 'none',
	preference: 'on-demand',
	needs: [],
	...overrides,
});

describe('recommendSetup', () => {
	it('gives a newcomer with Stremio and Real-Debrid the hosted Cast route', () => {
		const result = recommendSetup(answers());

		expect(result.primaryRoute.id).toBe('dmm-cast-stremio');
		expect(result.primaryRoute.title).toBe('DMM Cast → Stremio');
		expect(result.setupLinks).toEqual(
			expect.arrayContaining([{ label: 'DMM Cast for Real-Debrid', href: '/stremio' }])
		);
		expect(result.components).toContain('DMM Cast addon → your player');
		expect(result.conflicts).toHaveLength(0);
	});

	it('keeps TorBox hosted NZBs distinct from a normal torrent account', () => {
		const result = recommendSetup(
			answers({ sources: ['torbox-hosted'], player: 'stremio', host: 'none' })
		);

		expect(result.primaryRoute.id).toBe('torbox-hosted-stremio');
		expect(result.prerequisites).toContain('TorBox Pro and a way to submit the NZB');
		expect(result.sourceNotes.join(' ')).toMatch(/normal TorBox torrent subscription alone/i);
		expect(result.limits.join(' ')).toMatch(/finish and repair/i);
	});

	it("recommends Jellyfin's standalone NZB route for own NNTP", () => {
		const result = recommendSetup(
			answers({ player: 'jellyfin', sources: ['usenet'], host: 'existing' })
		);

		expect(result.primaryRoute.id).toBe('jellyfin-nzb-plugin');
		expect(result.components.join(' ')).toMatch(/standalone Jellyfin NZB plugin/i);
		expect(result.limits.join(' ')).toMatch(/PAR2/i);
		expect(result.setupLinks).toEqual(
			expect.arrayContaining([
				{
					label: 'DMM Jellyfin NZB setup',
					href: '/jellyfin',
				},
			])
		);
		expect(result.prerequisites.join(' ')).toMatch(/sponsorship/i);
	});

	it('requires a normal host for the Jellyfin NNTP route', () => {
		const result = recommendSetup(
			answers({ player: 'jellyfin', sources: ['usenet'], host: 'none' })
		);

		expect(result.conflicts.join(' ')).toMatch(/Jellyfin/i);
	});

	it('explains that Emby cannot consume own NNTP through the debrid plugin', () => {
		const result = recommendSetup(
			answers({ player: 'emby', sources: ['usenet'], host: 'none', preference: 'managed' })
		);

		expect(result.primaryRoute.id).toBe('emby-zurg-direct-usenet');
		expect(result.conflicts.join(' ')).toMatch(/needs a machine that stays on/i);
		expect(result.limits.join(' ')).toMatch(/distinct from TorBox hosted NZBs/i);
	});

	it('calls out the metadata boundary for HTTP-only rex', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'rex',
				sources: ['http-local'],
				host: 'willing',
				preference: 'managed',
			})
		);

		expect(result.primaryRoute.id).toBe('rex-http-plex');
		expect(result.prerequisites.join(' ')).toMatch(/feed producer/i);
		expect(result.limits.join(' ')).toMatch(/does not scan disks/i);
		expect(result.setupLinks).toEqual(
			expect.arrayContaining([
				{
					label: 'rex with any source',
					href: 'https://notes.debridmediamanager.com/rex/any-source/',
				},
			])
		);
	});

	it('does not treat Android as a rex host', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'rex',
				sources: ['url-addon'],
				host: 'android',
				preference: 'on-demand',
			})
		);

		expect(result.conflicts.join(' ')).toMatch(/rex/i);
	});

	it('does not treat Android as an Emby server host', () => {
		const result = recommendSetup(
			answers({ player: 'emby', sources: ['real-debrid'], host: 'android' })
		);

		expect(result.conflicts.join(' ')).toMatch(/Emby/i);
	});

	it('requires a host for zurg WebDAV with own NNTP', () => {
		const result = recommendSetup(
			answers({ player: 'webdav', sources: ['usenet'], host: 'none' })
		);

		expect(result.conflicts.join(' ')).toMatch(/zurg/i);
	});

	it('does not hide the no-host conflict from an arr user', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				preference: 'arr',
				host: 'none',
			})
		);

		expect(result.primaryRoute.id).toBe('arr-zurg');
		expect(result.conflicts.join(' ')).toMatch(/arr workflow needs a machine/i);
	});

	it('keeps the selected Stremio playback route when arr is selected', () => {
		const result = recommendSetup(
			answers({
				player: 'stremio',
				sources: ['real-debrid'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(result.components.join(' ')).toMatch(/zurg.*Stremio|Stremio.*zurg/i);
		expect(result.setupLinks.some((link) => /stremio/i.test(link.href))).toBe(true);
	});

	it('keeps the selected Jellyfin playback route when arr is selected', () => {
		const result = recommendSetup(
			answers({
				player: 'jellyfin',
				sources: ['real-debrid'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(result.components.join(' ')).toMatch(/mount.*Jellyfin|Jellyfin.*mount/i);
		expect(result.setupLinks.some((link) => /sonarr-radarr/i.test(link.href))).toBe(true);
	});

	it('includes acquisition and Wanted guidance for an arr workflow', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['real-debrid'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(result.setupLinks.some((link) => /sonarr-radarr/i.test(link.href))).toBe(true);
		expect(result.setupLinks.some((link) => /acquisition/i.test(link.href))).toBe(true);
	});

	it('keeps Easynews web access separate from an own NNTP account', () => {
		const result = recommendSetup(
			answers({ sources: ['easynews', 'usenet'], player: 'stremio' })
		);

		expect(result.sourceNotes.join(' ')).toMatch(/Easynews is a web account/i);
		expect(result.sourceNotes.join(' ')).toMatch(/separate source/i);
	});

	it('preserves requirements when several sources are selected', () => {
		const result = recommendSetup(
			answers({
				sources: ['real-debrid', 'usenet', 'http-local'],
				player: 'plex',
				plexRoute: 'rex',
				host: 'willing',
				preference: 'managed',
			})
		);

		expect(result.sourceNotes.join(' ')).toMatch(/Multiple sources can coexist/i);
		expect(result.sourceNotes.join(' ')).toMatch(/HTTP file or local disk/i);
		expect(result.components.join(' ')).toMatch(/zurg/i);
		expect(result.components.join(' ')).toMatch(/HTTP|local/i);
		expect(result.setupLinks.some((link) => /zurg|rex/i.test(link.label))).toBe(true);
		expect(result.sourceCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ source: 'real-debrid', status: 'integrated' }),
				expect.objectContaining({ source: 'usenet', status: 'integrated' }),
				expect.objectContaining({ source: 'http-local', status: 'integrated' }),
			])
		);
	});

	it('keeps direct Usenet visible beside a debrid Stremio route', () => {
		const result = recommendSetup(
			answers({ player: 'stremio', sources: ['real-debrid', 'usenet'], host: 'willing' })
		);

		expect(result.components.join(' ')).toMatch(/DMM Cast/i);
		expect(result.components.join(' ')).toMatch(/zurg.*Usenet|Usenet.*zurg/i);
		expect(result.setupLinks.some((link) => /zurg/i.test(link.label))).toBe(true);
	});

	it('keeps TorBox hosted NZBs visible beside a Jellyfin debrid plugin', () => {
		const result = recommendSetup(
			answers({
				player: 'jellyfin',
				sources: ['real-debrid', 'torbox-hosted'],
				host: 'willing',
			})
		);

		expect(result.components.join(' ')).toMatch(/provider plugin/i);
		expect(result.components.join(' ')).toMatch(/TorBox.*zurg|zurg.*TorBox/i);
		expect(result.sourceNotes.join(' ')).toMatch(/TorBox Pro/i);
		expect(result.sourceCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ source: 'real-debrid', status: 'integrated' }),
				expect.objectContaining({ source: 'torbox-hosted', status: 'integrated' }),
			])
		);
	});

	it('uses the existing Plex server directly for local-only files', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['http-local'],
				host: 'existing',
			})
		);

		expect(result.primaryRoute.title).toMatch(/existing Plex/i);
		expect(result.components.join(' ')).not.toMatch(/zurg/i);
	});

	it('keeps Kodi local files as the simplest route', () => {
		const result = recommendSetup(
			answers({ player: 'kodi', sources: ['http-local'], host: 'none' })
		);

		expect(result.primaryRoute.title).toMatch(/local|HTTP|share/i);
		expect(result.conflicts).toHaveLength(0);
	});

	it('offers an existing share for a WebDAV or SMB player', () => {
		const result = recommendSetup(
			answers({ player: 'webdav', sources: ['http-local'], host: 'none' })
		);

		expect(result.components.join(' ')).toMatch(/WebDAV|SMB|share/i);
		expect(result.components.join(' ')).not.toMatch(/zurg/i);
	});

	it('bridges TorBox hosted NZBs to Emby through zurg', () => {
		const result = recommendSetup(
			answers({ player: 'emby', sources: ['torbox-hosted'], host: 'willing' })
		);

		expect(result.components.join(' ')).toMatch(/TorBox.*zurg|zurg.*TorBox/i);
		expect(result.setupLinks.some((link) => /zurg/i.test(link.label))).toBe(true);
	});

	it('bridges own NNTP to an external player through zurg', () => {
		const result = recommendSetup(
			answers({ player: 'external', sources: ['usenet'], host: 'willing' })
		);

		expect(result.primaryRoute.title).toMatch(/zurg/i);
		expect(result.components.join(' ')).toMatch(/NNTP|Usenet/i);
		expect(result.conflicts.join(' ')).not.toMatch(/Choose a provider/i);
	});

	it('requires sponsorship for the zurg to rex Plex route', () => {
		const result = recommendSetup(
			answers({ player: 'plex', plexRoute: 'rex', sources: ['real-debrid'], host: 'willing' })
		);

		expect(result.prerequisites.join(' ')).toMatch(/sponsorship/i);
	});

	it('asks for a real host before using rex with raw URL addons', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'rex',
				sources: ['url-addon'],
				host: 'none',
				preference: 'managed',
			})
		);

		expect(result.primaryRoute.id).toBe('rex-stremio-plex');
		expect(result.conflicts.join(' ')).toMatch(/rex and its source/i);
		expect(result.limits.join(' ')).toMatch(/raw torrent streams are incompatible/i);
	});
});

describe('source coverage follows routes, not explanation wording', () => {
	it.each(['kodi', 'external'] as const)('uses a debrid account in %s', (player) => {
		expect(recommendSetup(answers({ player })).sourceCoverage[0].status).toBe('integrated');
	});
	it('uses an existing addon directly in Stremio', () => {
		expect(recommendSetup(answers({ sources: ['url-addon'] })).sourceCoverage[0].status).toBe(
			'integrated'
		);
	});
	it('does not require zurg for Cast alongside hosted TorBox NZBs', () => {
		const r = recommendSetup(answers({ sources: ['real-debrid', 'torbox-hosted'] }));
		expect(r.hostRequirement).toBe('none');
		expect(r.conflicts).toHaveLength(0);
	});
	it('keeps both NNTP and hosted NZBs in Stremio with their actual host requirements', () => {
		const r = recommendSetup(answers({ sources: ['usenet', 'torbox-hosted'] }));
		expect(r.hostRequirement).toBe('zurg');
		expect(r.conflicts.length).toBeGreaterThan(0);
	});
	it('adds the HTTP feed when rex also has URL addons', () => {
		const r = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'rex',
				sources: ['url-addon', 'http-local'],
				host: 'existing',
			})
		);
		expect(r.components.join(' ')).toMatch(/HTTP source/);
		expect(r.setupLinks.some((x) => x.href.endsWith('/rex/any-source/'))).toBe(true);
	});
	it('does not label local external playback as needing rex metadata', () => {
		const r = recommendSetup(answers({ player: 'external', sources: ['http-local'] }));
		expect(r.sourceCoverage[0].status).toBe('integrated');
		expect(r.sourceCoverage[0].requirements.join(' ')).not.toMatch(/rex/);
	});
});
