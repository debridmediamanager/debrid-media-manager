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

describe('sponsorship benefits follow the selected route', () => {
	const ids = (bucket: 'required' | 'optional', result: ReturnType<typeof recommendSetup>) =>
		result.sponsorship[bucket].map((benefit) => benefit.id);

	it('marks zurg and both arr indexers required, with the other upgrades optional', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['real-debrid', 'usenet'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(ids('required', result)).toEqual(
			expect.arrayContaining(['zurg-nightly', 'torznab', 'newznab'])
		);
		expect(ids('optional', result)).toEqual(
			expect.arrayContaining([
				'zurg-api-key',
				'wanted',
				'seerr',
				'uploader-priority',
				'sponsor-api',
				'remote-help',
				'discord-role',
			])
		);
	});

	it('shows Cast as a free route with only optional sponsor upgrades', () => {
		const result = recommendSetup(answers({ player: 'stremio', sources: ['real-debrid'] }));

		expect(ids('required', result)).toEqual([]);
		expect(ids('optional', result)).toEqual(
			expect.arrayContaining(['cast-streams', 'uploader-priority', 'discord-role'])
		);
		expect(result.sponsorship.freeFeatures).toContain('cast');
	});

	it('keeps rex and rex-stremio free when no sponsor-only backend is selected', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'rex',
				sources: ['url-addon'],
				host: 'willing',
			})
		);

		expect(ids('required', result)).toEqual([]);
		expect(ids('optional', result)).toEqual(
			expect.arrayContaining(['sponsor-api', 'remote-help', 'discord-role'])
		);
		expect(ids('required', result)).not.toContain('zurg-nightly');
		expect(result.sponsorship.freeFeatures).toContain('rex');
	});

	it('markets the standalone Jellyfin and Emby plugin gates as required', () => {
		const jellyfin = recommendSetup(
			answers({ player: 'jellyfin', sources: ['usenet'], host: 'existing' })
		);
		const emby = recommendSetup(
			answers({ player: 'emby', sources: ['real-debrid'], host: 'existing' })
		);

		expect(ids('required', jellyfin)).toContain('jellyfin-plugins');
		expect(ids('required', jellyfin)).not.toContain('zurg-nightly');
		expect(ids('optional', jellyfin)).not.toContain('remote-help');
		expect(ids('required', emby)).toContain('emby-plugins');
		expect(ids('required', emby)).not.toContain('zurg-nightly');
		expect(ids('optional', emby)).not.toContain('remote-help');
	});

	it('offers DMM Newznab as an optional indexer for Stremio direct Usenet search', () => {
		const result = recommendSetup(
			answers({ player: 'stremio', sources: ['usenet'], host: 'willing' })
		);

		expect(ids('required', result)).toEqual(['zurg-nightly']);
		expect(ids('optional', result)).toContain('newznab');
	});

	it('surfaces the Easynews to zurg sponsor path as an optional upgrade', () => {
		const result = recommendSetup(
			answers({ player: 'external', sources: ['easynews'], host: 'none' })
		);

		expect(ids('required', result)).toEqual([]);
		expect(ids('optional', result)).toEqual(
			expect.arrayContaining(['zurg-nightly', 'zurg-api-key', 'wanted', 'discord-role'])
		);
		expect(ids('optional', result)).toEqual(
			expect.arrayContaining(['sponsor-api', 'remote-help'])
		);
		expect(ids('optional', result)).not.toContain('seerr');
	});

	it('offers Kodi Wanted pinning through a running zurg host, including Easynews', () => {
		const result = recommendSetup(
			answers({ player: 'kodi', sources: ['easynews'], host: 'willing' })
		);

		expect(ids('optional', result)).toContain('wanted-kodi');
		expect(
			result.sponsorship.optional.find((benefit) => benefit.id === 'wanted-kodi')?.detail
		).toMatch(/Easynews.*running zurg host/i);
	});

	it('offers DMM Newznab to non-arr Usenet routes', () => {
		const result = recommendSetup(answers({ player: 'external', sources: ['usenet'] }));

		expect(ids('required', result)).toContain('zurg-nightly');
		expect(ids('optional', result)).toContain('newznab');
	});

	it('adds Wanted and Seerr alternatives for a family zurg setup', () => {
		const result = recommendSetup(
			answers({
				player: 'webdav',
				sources: ['real-debrid'],
				host: 'willing',
				needs: ['family'],
			})
		);

		expect(ids('optional', result)).toEqual(expect.arrayContaining(['wanted', 'seerr']));
	});

	it('keeps uploader priority limited to Real-Debrid hosted transfers', () => {
		const rd = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['real-debrid'],
				host: 'willing',
				preference: 'arr',
			})
		);
		const usenet = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['usenet'],
				host: 'willing',
				preference: 'arr',
			})
		);
		const torbox = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['torbox-hosted'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(ids('optional', rd)).toContain('uploader-priority');
		expect(ids('optional', usenet)).not.toContain('uploader-priority');
		expect(ids('optional', torbox)).not.toContain('uploader-priority');
	});

	it('deduplicates benefits across mixed provider routes', () => {
		const result = recommendSetup(
			answers({
				player: 'jellyfin',
				sources: ['real-debrid', 'all-debrid'],
				host: 'existing',
				preference: 'managed',
			})
		);
		const allIds = [...ids('required', result), ...ids('optional', result)];

		expect(ids('required', result)).toEqual(['jellyfin-plugins']);
		expect(new Set(allIds).size).toBe(allIds.length);
	});

	it('does not repeat a required indexer in the optional upgrades list', () => {
		const result = recommendSetup(
			answers({
				player: 'stremio',
				sources: ['usenet'],
				preference: 'arr',
				host: 'willing',
			})
		);

		expect(ids('required', result)).toContain('newznab');
		expect(ids('optional', result)).not.toContain('newznab');
	});

	it('keeps unsupported and no-source results free of sponsor-only claims', () => {
		const result = recommendSetup(
			answers({ player: 'stremio', sources: ['http-local'], host: 'none' })
		);
		const noSource = recommendSetup(answers({ player: 'stremio', sources: [] }));

		expect(ids('required', result)).toEqual([]);
		expect(ids('optional', result)).toEqual(['sponsor-benefits', 'discord-role']);
		expect(result.sponsorship.routeAvailable).toBe(false);
		expect(result.sponsorship.freeFeatures).toEqual([]);
		expect(ids('required', noSource)).toEqual([]);
		expect(ids('optional', noSource)).toEqual(['sponsor-benefits', 'discord-role']);
		expect(noSource.sponsorship.routeAvailable).toBe(false);
	});
});
