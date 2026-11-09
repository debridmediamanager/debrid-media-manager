import { describe, expect, it } from 'vitest';
import {
	HOST_OPTIONS,
	NEED_OPTIONS,
	PLAYER_OPTIONS,
	PREFERENCE_OPTIONS,
	SOURCE_OPTIONS,
	hostChoiceReason,
	recommendSetup,
	type Host,
	type Need,
	type Player,
	type PlexRoute,
	type Preference,
	type SetupAnswers,
	type SetupSource,
} from './setupQuestionnaire';

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
		expect(result.prerequisites).toContain('TorBox Pro and a way to submit the NZB.');
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

		expect(result.primaryRoute.id).toBe('resolve-constraints');
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

		expect(result.primaryRoute.id).toBe('resolve-constraints');
		expect(result.conflicts.join(' ')).toMatch(
			/arr workflow needs an existing or willing full host/i
		);
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

		expect(result.primaryRoute.id).toBe('resolve-constraints');
		expect(result.conflicts.join(' ')).toMatch(/rex and its source/i);
		expect(result.limits.join(' ')).toMatch(/raw torrent streams are incompatible/i);
	});
});

describe('URL addons are named as Stremio addons', () => {
	it('labels and describes the source as Stremio URL addons', () => {
		expect(SOURCE_OPTIONS.find(({ value }) => value === 'url-addon')).toEqual({
			value: 'url-addon',
			label: 'Existing Stremio URL addons',
			description: 'Stremio addons that already return playable HTTP streams.',
		});
		expect(recommendSetup(answers({ sources: ['url-addon'] })).sourceCoverage[0].label).toBe(
			'Existing Stremio URL addons'
		);
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

	it('requires only zurg for arr and offers both DMM indexers with the other upgrades', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['real-debrid', 'usenet'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(ids('required', result)).toEqual(['zurg-nightly']);
		expect(ids('optional', result)).toEqual(
			expect.arrayContaining([
				'torznab',
				'newznab',
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

	it.each(['stremio', 'kodi'] as const)(
		'offers ten other streams to %s, whose streams come from Cast',
		(player) => {
			const result = recommendSetup(answers({ player, sources: ['real-debrid'] }));

			expect(result.sponsorship.optional).toContainEqual({
				id: 'cast-streams',
				title: 'Ten other streams in Cast',
				detail: 'Raise the other-stream limit from five to ten per Cast profile, in Stremio and the Kodi addon.',
				href: '/settings',
			});
			expect(result.sponsorship.freeFeatures).toContain('cast');
		}
	);

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

	it('offers no zurg benefits for Easynews beside TorBox Cast without a host', () => {
		const result = recommendSetup(
			answers({ player: 'stremio', sources: ['easynews', 'torbox-hosted'], host: 'none' })
		);

		expect(ids('required', result)).toEqual([]);
		for (const id of ['zurg-nightly', 'zurg-api-key', 'wanted', 'sponsor-api', 'remote-help'])
			expect(ids('optional', result)).not.toContain(id);
	});

	it('offers DMM Wanted from Kodi as a title-level add for a running zurg host', () => {
		const result = recommendSetup(
			answers({ player: 'kodi', sources: ['real-debrid', 'easynews'], host: 'willing' })
		);

		expect(ids('optional', result)).toContain('wanted-kodi');
		expect(
			result.sponsorship.optional.find((benefit) => benefit.id === 'wanted-kodi')?.detail
		).toBe(
			'Add a film or show to your DMM Wanted list from the Kodi addon for zurg to fetch; this needs a running zurg host.'
		);
	});

	it('offers DMM Newznab to non-arr Usenet routes', () => {
		const result = recommendSetup(answers({ player: 'external', sources: ['usenet'] }));

		expect(ids('required', result)).toContain('zurg-nightly');
		expect(ids('optional', result)).toContain('newznab');
	});

	it('adds Wanted but not Seerr for a family zurg setup without a media server', () => {
		const result = recommendSetup(
			answers({
				player: 'webdav',
				sources: ['real-debrid'],
				host: 'willing',
				needs: ['family'],
			})
		);

		expect(ids('optional', result)).toContain('wanted');
		expect(ids('optional', result)).not.toContain('seerr');
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
		expect(
			rd.sponsorship.optional.find((benefit) => benefit.id === 'uploader-priority')?.detail
		).toBe(
			"Priority and 2 TB of Usenet a day instead of 300 GB on DMM's hosted NZB uploader, and three torrent jobs at once instead of one on the torrent uploader."
		);
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

	it('offers DMM Newznab to an arr user as an optional indexer', () => {
		const result = recommendSetup(
			answers({
				player: 'stremio',
				sources: ['usenet'],
				preference: 'arr',
				host: 'willing',
			})
		);

		expect(ids('required', result)).not.toContain('newznab');
		expect(ids('optional', result)).toContain('newznab');
	});

	it('keeps separate-only and no-source results free of sponsor-only claims', () => {
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

describe('constraints block unusable starting routes', () => {
	it('lists both missing arr prerequisites in one sentence', () => {
		const result = recommendSetup(answers({ sources: ['easynews'], preference: 'arr' }));

		expect(result.conflicts).toContain(
			'The arr workflow needs an existing or willing full host for Sonarr/Radarr and zurg, plus a supported debrid or NZB backend. Android and no host cannot run this workflow.'
		);
	});

	it('does not present arr as the starting route when the user has no source or host', () => {
		const result = recommendSetup({
			player: 'unsure',
			sources: ['none'],
			host: 'none',
			preference: 'arr',
			needs: ['family'],
		});

		expect(result.primaryRoute.id).toBe('resolve-constraints');
		expect(result.primaryRoute.title).toBe('Resolve the setup requirements first');
		expect(result.conflicts).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/arr.*supported debrid or NZB backend/i),
				expect.stringMatching(/existing or willing full host/i),
			])
		);
		expect(result.sponsorship.routeAvailable).toBe(false);
	});

	it('blocks arr when the selected sources cannot acquire releases', () => {
		const result = recommendSetup(
			answers({
				sources: ['easynews'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(result.primaryRoute.id).toBe('resolve-constraints');
		expect(result.conflicts.join(' ')).toMatch(/arr.*supported debrid or NZB backend/i);
	});

	it('keeps arr executable when a mixed source set includes a supported backend', () => {
		const result = recommendSetup(
			answers({
				sources: ['real-debrid', 'easynews'],
				host: 'willing',
				preference: 'arr',
			})
		);

		expect(result.primaryRoute.id).toBe('arr-zurg');
		expect(result.conflicts).toHaveLength(0);
	});
});

describe('bounded recommendation compatibility matrix', () => {
	const sourceValues = SOURCE_OPTIONS.filter(({ value }) => value !== 'none').map(
		({ value }) => value as SetupSource
	);
	const sourceSubsets: SetupSource[][] = [['none']];
	for (let mask = 0; mask < 1 << sourceValues.length; mask += 1) {
		sourceSubsets.push(sourceValues.filter((_, index) => (mask & (1 << index)) !== 0));
	}

	const playerModes: Array<{ player: Player; plexRoute?: PlexRoute }> = [
		...PLAYER_OPTIONS.filter(({ value }) => value !== 'plex').map(({ value }) => ({
			player: value as Player,
		})),
		{ player: 'plex', plexRoute: 'existing-server' },
		{ player: 'plex', plexRoute: 'rex' },
		{ player: 'plex', plexRoute: 'either' },
	];
	const hostValues = HOST_OPTIONS.map(({ value }) => value as Host);
	const preferenceValues = PREFERENCE_OPTIONS.map(({ value }) => value as Preference);
	const needValues = NEED_OPTIONS.map(({ value }) => value as Need);
	const structuralCaseCount =
		sourceSubsets.length * playerModes.length * hostValues.length * preferenceValues.length;
	const needEvidence: Record<Need, RegExp> = {
		remote: /secure(ly)? reachable|Hosted Cast\/direct playback/i,
		family: /provider IP and concurrency/i,
		offline: /offline copies/i,
		subtitles: /subtitle/i,
		mixed: /local files/i,
	};

	function assertInvariants(result: ReturnType<typeof recommendSetup>, input: SetupAnswers) {
		const context = JSON.stringify(input);
		const fail = (reason: string): never => {
			throw new Error(`${reason}; case=${context}`);
		};
		const selectedSources = [...new Set(input.sources)].filter((source) => source !== 'none');
		const coveredSources = result.sourceCoverage.map(({ source }) => source);
		if (
			coveredSources.length !== selectedSources.length ||
			new Set(coveredSources).size !== coveredSources.length ||
			selectedSources.some((source) => !coveredSources.includes(source))
		)
			fail('source coverage is not exactly one entry for every selected source');

		const benefitIds = [...result.sponsorship.required, ...result.sponsorship.optional].map(
			({ id }) => id
		);
		if (new Set(benefitIds).size !== benefitIds.length)
			fail('sponsorship benefits contain a duplicate');
		const requiredIds = new Set(result.sponsorship.required.map(({ id }) => id));
		if (result.sponsorship.optional.some(({ id }) => requiredIds.has(id)))
			fail('a required sponsorship benefit is also optional');
		if (new Set(result.setupLinks.map(({ href }) => href)).size !== result.setupLinks.length)
			fail('setup links contain a duplicate href');

		const integrated = result.sourceCoverage.some(({ status }) => status === 'integrated');
		const expectedAvailable = integrated && result.conflicts.length === 0;
		if (result.sponsorship.routeAvailable !== expectedAvailable)
			fail('route availability does not reflect integrated coverage and conflicts');
		if (result.conflicts.length && result.primaryRoute.id !== 'resolve-constraints')
			fail('a conflicting recommendation still has an executable starting route');
		if (!result.conflicts.length && result.primaryRoute.id === 'resolve-constraints')
			fail('a conflict-free recommendation is blocked');

		if (input.host === 'none' && result.hostRequirement !== 'none' && !result.conflicts.length)
			fail('a no-host route has a host requirement without a conflict');
		if (
			input.host === 'android' &&
			result.hostRequirement === 'server' &&
			!result.conflicts.length
		)
			fail('an Android route requiring a full server is not blocked');
		if (
			input.preference === 'arr' &&
			input.host !== 'existing' &&
			input.host !== 'willing' &&
			!result.conflicts.some((conflict) =>
				/arr workflow.*existing or willing full host/i.test(conflict)
			)
		)
			fail('arr without a full host has no explicit host conflict');
	}

	function forEachStructuralCase(
		callback: (
			mode: { player: Player; plexRoute?: PlexRoute },
			sources: SetupSource[],
			host: Host,
			preference: Preference
		) => void
	) {
		for (const mode of playerModes) {
			for (const sources of sourceSubsets) {
				for (const host of hostValues) {
					for (const preference of preferenceValues) {
						callback(mode, sources, host, preference);
					}
				}
			}
		}
	}

	it(`preserves route and sponsor invariants across ${structuralCaseCount} player/source/host/workflow cases`, () => {
		let cases = 0;
		forEachStructuralCase((mode, sources, host, preference) => {
			const input: SetupAnswers = {
				player: mode.player,
				plexRoute: mode.plexRoute,
				sources,
				host,
				preference,
				needs: [],
			};
			assertInvariants(recommendSetup(input), input);
			cases += 1;
		});
		expect(cases).toBe(structuralCaseCount);
	});

	it(
		`keeps the same invariants for every need combination across the structural matrix (${structuralCaseCount * (1 << needValues.length)} cases)`,
		{ timeout: 360_000 },
		() => {
			let cases = 0;
			forEachStructuralCase((mode, sources, host, preference) => {
				const baseline = recommendSetup({
					player: mode.player,
					plexRoute: mode.plexRoute,
					sources,
					host,
					preference,
					needs: [],
				});
				const baselineStable = JSON.stringify({
					primaryRoute: baseline.primaryRoute,
					hostRequirement: baseline.hostRequirement,
					conflicts: baseline.conflicts,
					routeAvailable: baseline.sponsorship.routeAvailable,
					coverage: baseline.sourceCoverage.map(({ source, status }) => [source, status]),
				});
				for (let mask = 0; mask < 1 << needValues.length; mask += 1) {
					const input: SetupAnswers = {
						player: mode.player,
						plexRoute: mode.plexRoute,
						sources,
						host,
						preference,
						needs: needValues.filter((_, index) => (mask & (1 << index)) !== 0),
					};
					const result = recommendSetup(input);
					const resultStable = JSON.stringify({
						primaryRoute: result.primaryRoute,
						hostRequirement: result.hostRequirement,
						conflicts: result.conflicts,
						routeAvailable: result.sponsorship.routeAvailable,
						coverage: result.sourceCoverage.map(({ source, status }) => [
							source,
							status,
						]),
					});
					if (resultStable !== baselineStable)
						throw new Error(
							`optional needs changed route, host or availability; case=${JSON.stringify(input)}`
						);
					const optionalNeeds = result.optionalNeeds.join(' ');
					for (const need of needValues) {
						const present = input.needs.includes(need);
						const evidenced = needEvidence[need].test(optionalNeeds);
						if (present && !evidenced)
							throw new Error(
								`need output coverage mismatch for ${need}; case=${JSON.stringify(input)}`
							);
					}
					cases += 1;
				}
			});
			expect(cases).toBe(structuralCaseCount * (1 << needValues.length));
		}
	);
});

describe('a source the player cannot use stays beside the route', () => {
	it('keeps Cast for Stremio and Real-Debrid when HTTP files are also selected', () => {
		const result = recommendSetup(answers({ sources: ['real-debrid', 'http-local'] }));

		expect(result.primaryRoute.id).toBe('dmm-cast-stremio');
		expect(result.sourceCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ source: 'http-local', status: 'separate' }),
			])
		);
		expect(result.conflicts).toEqual([]);
	});

	it('shows the separate HTTP route when it is the only source for Stremio', () => {
		const result = recommendSetup(answers({ sources: ['http-local'] }));

		expect(result.primaryRoute.id).toBe('http-source-needs-player');
		expect(result.conflicts).toEqual([]);
		expect(result.sponsorship.routeAvailable).toBe(false);
	});
});

describe('Easynews alone is not offered zurg benefits', () => {
	const optional = (result: ReturnType<typeof recommendSetup>) =>
		result.sponsorship.optional.map((benefit) => benefit.id);

	it('offers no zurg, Wanted, API or remote help for Stremio with Easynews only', () => {
		const ids = optional(recommendSetup(answers({ sources: ['easynews'] })));

		for (const id of ['zurg-nightly', 'zurg-api-key', 'wanted', 'sponsor-api', 'remote-help'])
			expect(ids).not.toContain(id);
	});

	it('offers no Kodi Wanted pinning for Easynews only', () => {
		expect(
			optional(recommendSetup(answers({ player: 'kodi', sources: ['easynews'] })))
		).not.toContain('wanted-kodi');
	});

	it.each(['on-demand', 'managed'] as const)(
		'never promises Easynews sends to a debrid-only zurg (%s)',
		(preference) => {
			const result = recommendSetup(
				answers({
					player: 'plex',
					plexRoute: 'existing-server',
					sources: ['real-debrid', 'easynews'],
					host: 'existing',
					preference,
				})
			);
			const wanted = result.sponsorship.optional.find((benefit) => benefit.id === 'wanted');

			expect(Boolean(wanted)).toBe(preference === 'managed');
			expect(wanted?.detail ?? '').not.toMatch(/Easynews/);
		}
	);

	it('says Easynews sends land in Wanted when zurg has an own Usenet backend', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['usenet', 'easynews'],
				host: 'existing',
			})
		);

		expect(result.sponsorship.optional.find((benefit) => benefit.id === 'wanted')?.detail).toBe(
			'Have zurg fetch requested films, shows, new episodes and upgrades for you. Easynews releases you send to zurg land here too.'
		);
	});

	it('offers Wanted once Easynews has an own Usenet backend', () => {
		expect(
			optional(recommendSetup(answers({ sources: ['easynews', 'usenet'], host: 'willing' })))
		).toContain('wanted');
	});
});

describe('provider WebDAV follows the chosen provider', () => {
	it.each([
		['real-debrid', 'Real-Debrid', 'https://dav.real-debrid.com/'],
		['all-debrid', 'AllDebrid', 'https://webdav.debrid.it/'],
		['premiumize', 'Premiumize', 'https://webdav.premiumize.me/'],
		['torbox', 'TorBox', 'https://webdav.torbox.app/'],
		['debrid-link', 'Debrid-Link', 'https://webdav.debrid.link/'],
	] as const)('sends %s straight to its own WebDAV without a host', (source, label, address) => {
		const result = recommendSetup(
			answers({ player: 'webdav', sources: [source], host: 'none' })
		);

		expect(result.primaryRoute.id).toBe('provider-webdav');
		expect(result.primaryRoute.title).toBe(`${label} WebDAV → your WebDAV or SMB player`);
		expect(result.components).toEqual([`${label} WebDAV → your WebDAV or SMB player`]);
		expect(result.prerequisites.join(' ')).toContain(address);
		expect(result.limits.join(' ')).toMatch(/zurg is not involved/);
		expect(result.conflicts).toEqual([]);
	});

	it.each([['offcloud', 'Offcloud']] as const)(
		'needs zurg on a host for %s, which has no WebDAV',
		(source, label) => {
			const result = recommendSetup(
				answers({ player: 'webdav', sources: [source], host: 'none' })
			);

			expect(result.sourceCoverage[0].integration).toBe(
				`${label} → zurg → your WebDAV or SMB player`
			);
			expect(result.components).toEqual([
				`${label} → zurg debrid library → WebDAV → your WebDAV or SMB player`,
			]);
			expect(result.hostRequirement).toBe('zurg');
			expect(result.conflicts.join(' ')).toMatch(/zurg needs a host/);
			expect(result.sourceNotes).toContain(
				`${label} has no WebDAV of its own, so a WebDAV player needs zurg on a host.`
			);
		}
	);

	it('names the provider WebDAV as an alternative to zurg on a host', () => {
		const result = recommendSetup(
			answers({ player: 'webdav', sources: ['real-debrid'], host: 'existing' })
		);

		expect(result.primaryRoute.id).toBe('webdav-zurg-debrid');
		expect(result.alternatives).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: 'Skip zurg: Real-Debrid WebDAV',
					detail: expect.stringContaining('https://dav.real-debrid.com/'),
				}),
			])
		);
	});
});

describe('the Torznab benefit matches the Torznab page', () => {
	it('does not offer Torznab to a managed library without Sonarr or Radarr', () => {
		const result = recommendSetup(answers({ preference: 'managed' }));

		expect(result.sponsorship.optional.map((benefit) => benefit.id)).not.toContain('torznab');
	});

	it('offers Torznab for Sonarr/Radarr and describes where its cached status comes from', () => {
		const result = recommendSetup(answers({ host: 'willing', preference: 'arr' }));
		const torznab = result.sponsorship.optional.find((benefit) => benefit.id === 'torznab');

		expect(torznab?.detail).toBe(
			"Search DMM as a Torznab indexer from Prowlarr, Sonarr or Radarr. Cached status comes from DMM's own record for Real-Debrid, AllDebrid and Debrid-Link; the TorBox, Premiumize and Offcloud feeds answer once your key is linked."
		);
		expect(torznab?.detail).not.toMatch(/live cache feeds/);
	});
});

describe('host messages name the server that needs the host', () => {
	it.each([
		[{ player: 'plex', plexRoute: 'existing-server' }, 'Plex Media Server'],
		[{ player: 'jellyfin' }, 'Jellyfin'],
		[{ player: 'emby' }, 'Emby'],
	] as const)('says zurg Android cannot give %o a library', (mode, name) => {
		expect(hostChoiceReason({ ...mode, sources: [] }, 'android')).toBe(
			`${name} needs a full server host; zurg Android cannot give a server on that device a library.`
		);
	});

	it.each([
		{ player: 'plex', plexRoute: 'rex' },
		{ player: 'plex', plexRoute: 'either' },
	] as const)('says Android cannot run rex for %o', (mode) => {
		expect(hostChoiceReason({ ...mode, sources: [] }, 'android')).toBe(
			'rex needs a full server host; Android can run zurg, not rex.'
		);
	});

	it('gives the Android conflict the same reason', () => {
		expect(recommendSetup(answers({ player: 'emby', host: 'android' })).conflicts).toContain(
			'Emby needs a full server host; zurg Android cannot give a server on that device a library.'
		);
	});

	it('says Plex Media Server needs a machine that stays on', () => {
		const result = recommendSetup(
			answers({ player: 'plex', plexRoute: 'existing-server', host: 'none' })
		);

		expect(result.conflicts).toContain(
			'Plex Media Server needs a machine that stays on. Choose a host.'
		);
	});

	it('says rex and its source need a machine that stays on', () => {
		const result = recommendSetup(answers({ player: 'plex', plexRoute: 'rex', host: 'none' }));

		expect(result.conflicts.join(' ')).toMatch(
			/^rex and its source need a machine that stays on\./
		);
	});
});

describe('an undecided player with only an own Usenet account', () => {
	it('starts with zurg and a WebDAV player, which needs no indexer', () => {
		const result = recommendSetup(
			answers({ player: 'unsure', sources: ['usenet'], host: 'willing' })
		);

		expect(result.primaryRoute.id).toBe('webdav-zurg-direct-usenet');
		expect(result.conflicts).toEqual([]);
	});

	it('still starts with Stremio Cast when a debrid account is also selected', () => {
		const result = recommendSetup(
			answers({ player: 'unsure', sources: ['usenet', 'real-debrid'], host: 'willing' })
		);

		expect(result.whyMatched[0]).toMatch(/Stremio is a starting option/);
		expect(result.sourceCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: 'real-debrid',
					integration: 'DMM Cast → Stremio',
				}),
			])
		);
	});

	it('still starts with TorBox Cast for TorBox hosted NZBs', () => {
		const result = recommendSetup(answers({ player: 'unsure', sources: ['torbox-hosted'] }));

		expect(result.primaryRoute.id).toBe('torbox-hosted-stremio');
	});

	it('starts TorBox hosted NZBs on TorBox Cast beside files too, without zurg', () => {
		const result = recommendSetup(
			answers({ player: 'unsure', sources: ['torbox-hosted', 'http-local'], host: 'none' })
		);

		expect(result.whyMatched[0]).toMatch(/Stremio is a starting option/);
		expect(result.primaryRoute.id).toBe('torbox-hosted-stremio');
		expect(result.components.join(' ')).not.toMatch(/zurg/);
		expect(result.conflicts).toEqual([]);
	});
});

describe('Kodi with TorBox hosted NZBs', () => {
	it.each(['none', 'existing'] as const)(
		'plays them from the Kodi addon’s TorBox library (host %s)',
		(host) => {
			const result = recommendSetup(
				answers({ player: 'kodi', sources: ['torbox-hosted'], host })
			);

			expect(result.primaryRoute.id).toBe('dmm-kodi');
			expect(result.conflicts).toEqual([]);
			expect(result.sponsorship.required.map((benefit) => benefit.id)).not.toContain(
				'zurg-nightly'
			);
			expect(result.prerequisites).toContain(
				"TorBox Pro. Submit NZBs from DMM's Usenet tab; finished downloads appear in the addon's TorBox library."
			);
			expect(result.sourceNotes.join(' ')).toMatch(
				/normal TorBox torrent subscription alone/
			);
			expect(result.limits.join(' ')).toMatch(/finish and repair/);
		}
	);
});

describe('a no-host conflict names a route the player can use', () => {
	const zurgHost =
		'zurg needs a host that stays on while you watch. Choose a host or a supported Android device';
	const conflicts = (overrides: Partial<SetupAnswers>) =>
		recommendSetup(answers({ host: 'none', ...overrides })).conflicts;

	it.each([
		[
			{ player: 'stremio' },
			`${zurgHost}, or switch to TorBox hosted NZBs through TorBox Cast or DMM's Real-Debrid transfer, which need no host.`,
		],
		[
			{ player: 'kodi' },
			`${zurgHost}, or switch to TorBox hosted NZBs through the Kodi addon or DMM's Real-Debrid transfer, which need no host.`,
		],
		[
			{ player: 'external' },
			`${zurgHost}, or switch to Real-Debrid and use DMM's transfer with DMM Watch, which need no host.`,
		],
		[{ player: 'webdav' }, `${zurgHost}.`],
		[
			{ player: 'unsure' },
			`${zurgHost}, or switch to TorBox hosted NZBs through TorBox Cast in Stremio or DMM's Real-Debrid transfer, which need no host.`,
		],
		[
			{ player: 'plex', plexRoute: 'existing-server' },
			'Plex Media Server needs a machine that stays on. Choose a host.',
		],
		[
			{ player: 'plex', plexRoute: 'rex' },
			'rex and its source need a machine that stays on. Choose a host.',
		],
		[
			{ player: 'plex', plexRoute: 'either' },
			'rex and its source need a machine that stays on. Choose a host.',
		],
		[{ player: 'jellyfin' }, 'Jellyfin needs a machine that stays on. Choose a host.'],
		[{ player: 'emby' }, 'Emby needs a machine that stays on. Choose a host.'],
	] satisfies [Partial<SetupAnswers>, string][])(
		'answers own Usenet without a host per player (%o)',
		(mode, conflict) => {
			expect(conflicts({ ...mode, sources: ['usenet'] })).toEqual([conflict]);
		}
	);

	it.each([
		[
			{ player: 'stremio', sources: ['real-debrid', 'usenet'] },
			`${zurgHost}, or use DMM Cast with that account, which needs no host.`,
		],
		[
			{ player: 'stremio', sources: ['torbox-hosted', 'usenet'] },
			`${zurgHost}, or use TorBox Cast, which needs no host.`,
		],
		[
			{ player: 'kodi', sources: ['usenet', 'torbox-hosted'] },
			`${zurgHost}, or use the Kodi addon with that account, which needs no host.`,
		],
		[
			{ player: 'external', sources: ['easynews', 'usenet'] },
			`${zurgHost}, or use DMM Watch with that account, which needs no host.`,
		],
		[
			{ player: 'external', sources: ['torbox-hosted'] },
			'zurg needs a host that stays on while you watch. Choose a host.',
		],
		[
			{ player: 'webdav', sources: ['usenet', 'real-debrid'] },
			`${zurgHost}, or use Real-Debrid WebDAV, which needs no host.`,
		],
		[{ player: 'webdav', sources: ['offcloud'] }, `${zurgHost}.`],
		[{ player: 'webdav', sources: ['offcloud', 'usenet'] }, `${zurgHost}.`],
		[
			{ player: 'plex', plexRoute: 'existing-server', sources: ['torbox-hosted'] },
			'Plex Media Server needs a machine that stays on. Choose a host.',
		],
		[
			{ player: 'plex', plexRoute: 'rex', sources: ['url-addon'] },
			'rex and its source need a machine that stays on. Choose a host.',
		],
	] satisfies [Partial<SetupAnswers>, string][])(
		'names only a route the player has (%o)',
		(overrides, conflict) => {
			expect(conflicts(overrides)).toEqual([conflict]);
		}
	);
});

describe('a free Plex route for debrid accounts', () => {
	const freeRoute = (result: ReturnType<typeof recommendSetup>) =>
		result.alternatives.find(
			({ title }) => title === 'Without zurg: rex-stremio with a debrid stream addon'
		);

	it.each(['rex', 'either'] as const)('offers rex-stremio for Plex apps (%s)', (plexRoute) => {
		const alternative = freeRoute(
			recommendSetup(
				answers({ player: 'plex', plexRoute, sources: ['real-debrid'], host: 'willing' })
			)
		);

		expect(alternative).toEqual({
			title: 'Without zurg: rex-stremio with a debrid stream addon',
			detail: 'Run rex and rex-stremio with a Stremio stream addon that returns links through your debrid account; no zurg and no sponsorship needed.',
			links: [
				{
					label: 'rex with Stremio addons',
					href: 'https://notes.debridmediamanager.com/rex/stremio/',
				},
			],
		});
	});

	it('leaves it out when URL addons are already the route', () => {
		expect(
			freeRoute(
				recommendSetup(
					answers({
						player: 'plex',
						plexRoute: 'rex',
						sources: ['real-debrid', 'url-addon'],
						host: 'willing',
					})
				)
			)
		).toBeUndefined();
	});

	it('leaves it out for an existing Plex Media Server', () => {
		expect(
			freeRoute(
				recommendSetup(
					answers({
						player: 'plex',
						plexRoute: 'existing-server',
						sources: ['real-debrid'],
						host: 'willing',
					})
				)
			)
		).toBeUndefined();
	});
});

describe('Wanted and Seerr need a zurg that can run', () => {
	const offered = (result: ReturnType<typeof recommendSetup>) =>
		[...result.sponsorship.required, ...result.sponsorship.optional].map(({ id }) => id);

	it('offers neither to Stremio Cast with no host', () => {
		const ids = offered(recommendSetup(answers({ host: 'none', preference: 'managed' })));

		expect(ids).not.toContain('wanted');
		expect(ids).not.toContain('seerr');
	});

	it('offers Wanted, not Seerr, to Stremio Cast once a host can run zurg', () => {
		const ids = offered(recommendSetup(answers({ host: 'willing', preference: 'managed' })));

		expect(ids).toContain('wanted');
		expect(ids).not.toContain('seerr');
	});

	it.each([
		{ host: 'willing', preference: 'managed' },
		{ player: 'kodi', host: 'existing' },
		{ player: 'jellyfin', host: 'existing', preference: 'managed' },
	] satisfies Partial<SetupAnswers>[])(
		'offers zurg nightly with Wanted when the route does not run zurg (%o)',
		(overrides) => {
			const result = recommendSetup(answers(overrides));

			expect(result.sponsorship.required.map(({ id }) => id)).not.toContain('zurg-nightly');
			expect(result.sponsorship.optional.map(({ id }) => id)).toContain('zurg-nightly');
		}
	);

	it('offers no Kodi Wanted to the Kodi addon with no host', () => {
		expect(offered(recommendSetup(answers({ player: 'kodi', host: 'none' })))).not.toContain(
			'wanted-kodi'
		);
	});

	it('suggests the Wanted route only with a debrid or NZB backend', () => {
		const alternative = (sources: SetupSource[]) =>
			recommendSetup(
				answers({ sources, host: 'willing', preference: 'managed' })
			).alternatives.some(({ title }) => title === 'DMM Wanted requests');

		expect(alternative(['easynews'])).toBe(false);
		expect(alternative(['real-debrid'])).toBe(true);
	});
});

describe('Seerr needs a Plex, Jellyfin or Emby server to request against', () => {
	const managed = (overrides: Partial<SetupAnswers>) =>
		recommendSetup(
			answers({ host: 'willing', preference: 'managed', needs: ['family'], ...overrides })
		);
	const seerrLink = 'https://notes.debridmediamanager.com/dmm/seerr/';

	it.each([
		{ player: 'plex', plexRoute: 'existing-server' },
		{ player: 'plex', plexRoute: 'either' },
		{ player: 'jellyfin' },
		{ player: 'emby' },
	] satisfies Partial<SetupAnswers>[])('offers Seerr with a media server (%o)', (mode) => {
		const result = managed(mode);

		expect(result.sponsorship.optional.map(({ id }) => id)).toContain('seerr');
		expect(result.alternatives).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: 'DMM Wanted or Seerr requests',
					links: expect.arrayContaining([expect.objectContaining({ href: seerrLink })]),
				}),
			])
		);
	});

	it.each([
		{ player: 'plex', plexRoute: 'rex' },
		{ player: 'stremio' },
		{ player: 'kodi' },
		{ player: 'webdav' },
		{ player: 'external' },
	] satisfies Partial<SetupAnswers>[])('leaves Seerr out without a media server (%o)', (mode) => {
		const result = managed(mode);
		const wanted = result.alternatives.find(({ title }) => title.startsWith('DMM Wanted'));

		expect(result.sponsorship.optional.map(({ id }) => id)).not.toContain('seerr');
		expect(wanted).toEqual({
			title: 'DMM Wanted requests',
			detail: expect.stringMatching(
				/^Use Wanted → zurg for automatic acquisition without arr\. These need sponsorship and a running zurg host/
			),
			links: [
				{
					label: 'DMM Wanted setup',
					href: 'https://notes.debridmediamanager.com/zurg/guides/dmm-wanted/',
				},
			],
		});
	});

	it.each([
		[{ player: 'plex', plexRoute: 'existing-server' }, false],
		[{ player: 'plex', plexRoute: 'rex' }, false],
		[{ player: 'plex', plexRoute: 'either' }, false],
		[{ player: 'jellyfin' }, false],
		[{ player: 'emby' }, false],
		[{ player: 'webdav' }, false],
		[{ player: 'stremio' }, true],
		[{ player: 'kodi' }, true],
		[{ player: 'external' }, true],
	] satisfies [Partial<SetupAnswers>, boolean][])(
		'mentions browsing hosted Cast libraries only where the player has them (%o)',
		(mode, cast) => {
			const detail = managed(mode).alternatives.find(({ title }) =>
				title.startsWith('DMM Wanted')
			)?.detail;

			expect(detail).toMatch(/These need sponsorship and a running zurg host[;.]/);
			expect(
				detail?.endsWith(
					'; hosted Cast libraries do not need your own server just to browse them.'
				)
			).toBe(cast);
		}
	);
});

describe('Sonarr/Radarr results explain the zurg they hand releases to', () => {
	const zurgSetup = {
		label: 'zurg setup',
		href: 'https://notes.debridmediamanager.com/zurg/setup/',
	};

	it('links zurg setup and its debrid account step beside Stremio Cast', () => {
		const result = recommendSetup(answers({ host: 'existing', preference: 'arr' }));

		expect(result.setupLinks).toContainEqual(zurgSetup);
		expect(result.prerequisites).toContain(
			'Configure your Real-Debrid account in zurg; Sonarr/Radarr hand torrents to it.'
		);
	});

	it('says to give zurg a torbox_nzb account beside the Kodi addon', () => {
		const result = recommendSetup(
			answers({
				player: 'kodi',
				sources: ['torbox-hosted'],
				host: 'existing',
				preference: 'arr',
			})
		);

		expect(result.setupLinks).toContainEqual(zurgSetup);
		expect(result.prerequisites).toContain(
			'Give zurg a torbox_nzb account (TorBox Pro); Sonarr/Radarr hand NZBs to it.'
		);
	});

	it('says to give zurg an nzb account for own Usenet', () => {
		const result = recommendSetup(
			answers({
				player: 'jellyfin',
				sources: ['usenet', 'all-debrid'],
				host: 'existing',
				preference: 'arr',
			})
		);

		expect(result.prerequisites).toEqual(
			expect.arrayContaining([
				'Give zurg an nzb account with your NNTP credentials; Sonarr/Radarr hand NZBs to it.',
				'Configure your AllDebrid account in zurg; Sonarr/Radarr hand torrents to it.',
			])
		);
	});
});

describe('DMM Newznab follows the routes that search an indexer', () => {
	const newznab = (overrides: Partial<SetupAnswers>) =>
		recommendSetup(answers(overrides)).sponsorship.optional.find(
			(benefit) => benefit.id === 'newznab'
		);

	it("names zurg's Stremio addon and zurg acquisition for own Usenet through zurg", () => {
		expect(newznab({ sources: ['usenet'], host: 'willing' })?.detail).toBe(
			"Search DMM as a Newznab indexer from Prowlarr, Sonarr or Radarr, zurg's Stremio addon, or zurg acquisition for Wanted and watchlists."
		);
	});

	it.each([
		{
			player: 'plex',
			plexRoute: 'existing-server',
			sources: ['torbox-hosted'],
			host: 'willing',
		},
		{ player: 'webdav', sources: ['torbox-hosted'], host: 'existing' },
		{ player: 'kodi', sources: ['torbox-hosted'], host: 'existing', preference: 'arr' },
	] satisfies Partial<SetupAnswers>[])(
		'is offered when zurg searches for TorBox hosted NZBs (%o)',
		(overrides) => {
			expect(newznab(overrides)?.id).toBe('newznab');
		}
	);

	it.each([
		{ sources: ['torbox-hosted'], host: 'none' },
		{ player: 'kodi', sources: ['torbox-hosted'], host: 'existing' },
		{ player: 'jellyfin', sources: ['usenet'], host: 'existing' },
	] satisfies Partial<SetupAnswers>[])(
		'is not offered without a zurg NZB route or Sonarr/Radarr (%o)',
		(overrides) => {
			expect(newznab(overrides)).toBeUndefined();
		}
	);
});

describe('players read naturally mid-sentence', () => {
	it.each([
		['stremio', 'You chose Stremio.'],
		['external', 'You chose an external player.'],
		['webdav', 'You chose a WebDAV or SMB player.'],
	] as const)('says the user chose %s', (player, sentence) => {
		expect(recommendSetup(answers({ player, host: 'willing' })).whyMatched[0]).toBe(sentence);
	});

	it.each([
		[{ player: 'plex', plexRoute: 'existing-server' }, 'your existing Plex Media Server'],
		[{ player: 'jellyfin' }, 'Jellyfin'],
		[{ player: 'emby' }, 'Emby'],
		[{ player: 'kodi' }, 'Kodi'],
		[{ player: 'webdav' }, 'your WebDAV or SMB player'],
		[{ player: 'external' }, 'your external player'],
	] satisfies [Partial<SetupAnswers>, string][])(
		'keeps local files in %o without "your" before a product name',
		(mode, name) => {
			const result = recommendSetup(
				answers({ ...mode, sources: ['http-local'], host: 'existing' })
			);

			expect(result.primaryRoute.title).toBe(`Keep ${name} for local or HTTP files`);
			expect(result.components).toEqual([
				`Local files or a compatible HTTP/network source → ${name}`,
			]);
		}
	);

	it('names the starting player for an undecided user', () => {
		expect(
			recommendSetup(answers({ player: 'unsure', sources: ['http-local'] })).whyMatched[0]
		).toBe(
			'You have not chosen a player; an external player is a starting option for these sources.'
		);
	});

	it('combines sources in your external player', () => {
		expect(
			recommendSetup(
				answers({ player: 'external', sources: ['real-debrid', 'usenet'], host: 'willing' })
			).primaryRoute.title
		).toBe('Combine your sources in your external player');
	});

	it('combines two providers that share a route id but not a title', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['real-debrid', 'all-debrid'],
				host: 'existing',
			})
		);

		expect(result.primaryRoute).toEqual(
			expect.objectContaining({
				id: 'combined-sources',
				title: 'Combine your sources in Plex apps',
			})
		);
	});
});

describe('"None yet" shows which accounts work with the player', () => {
	it('describes the option that way', () => {
		expect(SOURCE_OPTIONS.find(({ value }) => value === 'none')?.description).toBe(
			'Show me which accounts work with my player.'
		);
	});

	const bytes = ' DMM does not supply video bytes by itself.';
	const plex = `Any debrid account or your own Usenet account works through zurg on a host; files you already have stay in the server.${bytes}`;
	const jellyfin = `Any debrid account works through a provider plugin or zurg on a host; your own Usenet account through the NZB plugin or zurg; files you already have stay in the server.${bytes}`;
	const emby = `Any debrid account works through a provider plugin or zurg on a host; your own Usenet account through zurg; files you already have stay in the server.${bytes}`;
	const rex =
		'Any debrid or Usenet account works through zurg → rex on a host; Stremio URL addons through rex-stremio; local files need a feed producer. DMM does not supply video bytes by itself.';

	it.each([
		[
			{ player: 'stremio' },
			'Choose a source for Stremio',
			'A debrid or Easynews account works through DMM Cast with no host; TorBox Pro hosted NZBs through TorBox Cast; your own Usenet account needs zurg on a host. DMM does not supply video bytes by itself.',
		],
		[
			{ player: 'webdav' },
			'Choose a source for your WebDAV or SMB player',
			'Real-Debrid, AllDebrid, Premiumize, TorBox and Debrid-Link serve their own WebDAV with no host; Offcloud and Usenet need zurg on a host. DMM does not supply video bytes by itself.',
		],
		[
			{ player: 'kodi' },
			'Choose a source for Kodi',
			'A debrid, Easynews or TorBox Pro account works through the Kodi addon with no host; your own Usenet account needs zurg on a host. DMM does not supply video bytes by itself.',
		],
		[
			{ player: 'external' },
			'Choose a source for your external player',
			'A debrid or Easynews account works through DMM Watch with no host; your own Usenet account needs zurg on a host. DMM does not supply video bytes by itself.',
		],
		[{ player: 'plex', plexRoute: 'existing-server' }, 'Choose a source for Plex apps', plex],
		[{ player: 'jellyfin' }, 'Choose a source for Jellyfin', jellyfin],
		[{ player: 'emby' }, 'Choose a source for Emby', emby],
		[{ player: 'plex', plexRoute: 'rex' }, 'Choose a source for Plex apps', rex],
		[{ player: 'plex', plexRoute: 'either' }, 'Choose a source for Plex apps', rex],
	] satisfies [Partial<SetupAnswers>, string, string][])(
		'lists the accounts that work for %o',
		(mode, title, summary) => {
			expect(recommendSetup(answers({ ...mode, sources: ['none'] })).primaryRoute).toEqual({
				id: 'choose-source-first',
				title,
				summary,
			});
		}
	);
});

describe('route copy stays on the player and source it is about', () => {
	it('keeps the Emby plugin limit off the Jellyfin plugin route', () => {
		const limits = (player: 'jellyfin' | 'emby') =>
			recommendSetup(answers({ player, host: 'existing' })).limits;

		expect(limits('jellyfin')).toContain('Plugins have their own archive/version limits.');
		expect(limits('jellyfin').join(' ')).not.toMatch(/Emby/);
		expect(limits('emby')).toContain(
			'Plugins have their own archive/version limits. DMM Emby plugins cover debrid, not direct NNTP or hosted NZBs.'
		);
	});

	it('mentions the rex feed for separate Easynews only on a rex route', () => {
		const requirements = (overrides: Partial<SetupAnswers>) =>
			recommendSetup(answers({ sources: ['easynews'], host: 'existing', ...overrides }))
				.sourceCoverage[0].requirements;

		expect(requirements({ player: 'plex', plexRoute: 'existing-server' })).toEqual([
			'Keep Easynews in a compatible player.',
		]);
		expect(requirements({ player: 'jellyfin' })).toEqual([
			'Keep Easynews in a compatible player.',
		]);
		expect(requirements({ player: 'plex', plexRoute: 'rex' })).toEqual([
			'Keep Easynews in a compatible player. For rex, a compatible URL addon or feed producer must supply streams and metadata.',
		]);
	});

	it('says Stremio searches Easynews rather than a provider library', () => {
		const components = recommendSetup(answers({ sources: ['easynews'] })).components;

		expect(components).toContain('Stremio searches Easynews and plays its files.');
		expect(components).not.toContain('Stremio plays the selected provider library.');
		expect(recommendSetup(answers()).components).toContain(
			'Stremio plays the selected provider library.'
		);
	});

	it('warns about Real-Debrid’s one public IP only when Real-Debrid is selected', () => {
		const needs = (sources: SetupSource[]) =>
			recommendSetup(answers({ sources, needs: ['family'] })).optionalNeeds;

		expect(needs(['all-debrid'])).toContain('Check provider IP and concurrency rules.');
		expect(needs(['real-debrid'])).toContain(
			'Check provider IP and concurrency rules. Real-Debrid use must stay on one public IP; direct playback from different homes can violate that even with a central catalog.'
		);
	});

	it.each([
		[
			{},
			'Stremio needs a compatible addon for local files; cloud titles come from the routes above.',
		],
		[
			{ player: 'webdav' },
			'Local files stay in your player; cloud titles come from the routes above.',
		],
		[
			{ player: 'jellyfin' },
			'Keep local files in your existing media server alongside cloud integrations.',
		],
		[
			{ player: 'plex', plexRoute: 'existing-server' },
			'Keep local files in your existing media server alongside cloud integrations.',
		],
		[
			{ player: 'plex', plexRoute: 'rex' },
			'Local files join rex through an HTTP source and a feed producer; each source supplies its own metadata and reachable HTTP bytes.',
		],
		[
			{ player: 'plex', plexRoute: 'either' },
			'Local files join rex through an HTTP source and a feed producer; each source supplies its own metadata and reachable HTTP bytes.',
		],
		[
			{ player: 'emby' },
			'Keep local files in your existing media server alongside cloud integrations.',
		],
		[
			{ player: 'kodi' },
			'Local files stay in your player; cloud titles come from the routes above.',
		],
	] satisfies [Partial<SetupAnswers>, string][])(
		'says where local files stay for %o',
		(overrides, text) => {
			const result = recommendSetup(
				answers({ host: 'existing', ...overrides, needs: ['mixed'] })
			);

			expect(result.optionalNeeds).toEqual([text]);
		}
	);

	it.each([
		[
			{ host: 'existing', preference: 'arr' },
			'Hosted Cast/direct playback avoids exposing a home server; any NAS or file server still needs a secure reachable connection for remote use.',
		],
		[
			{ player: 'webdav', host: 'existing' },
			'Self-hosted playback needs a securely reachable address; a LAN address works only at home.',
		],
		[
			{ player: 'kodi', sources: ['usenet'], host: 'android' },
			'zurg runs on the device you watch on, so away from home it travels with you; a NAS or file server at home still needs a secure reachable connection.',
		],
		[
			{
				player: 'plex',
				plexRoute: 'existing-server',
				sources: ['easynews'],
				host: 'existing',
			},
			'Self-hosted playback needs a securely reachable address; a LAN address works only at home.',
		],
		[
			{ player: 'plex', plexRoute: 'rex', sources: ['none'], host: 'willing' },
			'Self-hosted playback needs a securely reachable address; a LAN address works only at home.',
		],
	] satisfies [Partial<SetupAnswers>, string][])(
		'says what remote playback needs for %o',
		(overrides, text) => {
			expect(
				recommendSetup(answers({ ...overrides, needs: ['remote'] })).optionalNeeds[0]
			).toBe(text);
		}
	);

	const bazarr = 'https://notes.debridmediamanager.com/zurg/guides/subtitles/';

	it.each([{}, { player: 'webdav', host: 'willing' }] satisfies Partial<SetupAnswers>[])(
		'points at player subtitles, not Bazarr, without Sonarr/Radarr (%o)',
		(overrides) => {
			const result = recommendSetup(answers({ ...overrides, needs: ['subtitles'] }));

			expect(result.optionalNeeds).toContain(
				'Check embedded/player subtitle support in your player.'
			);
			expect(result.setupLinks.map(({ href }) => href)).not.toContain(bazarr);
		}
	);

	it('keeps rex subtitle search for rex without zurg, minus the Bazarr link', () => {
		const result = recommendSetup(
			answers({
				player: 'plex',
				plexRoute: 'rex',
				sources: ['url-addon'],
				host: 'willing',
				needs: ['subtitles'],
			})
		);

		expect(result.optionalNeeds).toContain(
			'rex offers Search Subtitles without Bazarr. Embedded/player subtitles may already be sufficient.'
		);
		expect(result.setupLinks.map(({ href }) => href)).not.toContain(bazarr);
	});

	it('keeps the Bazarr note for Sonarr/Radarr, whose imports Bazarr works from', () => {
		const result = recommendSetup(
			answers({ host: 'willing', preference: 'arr', needs: ['subtitles'] })
		);

		expect(result.optionalNeeds).toContain(
			'Check embedded/player subtitle support. For arr and zurg, Bazarr can store local sidecar subtitles.'
		);
		expect(result.setupLinks.map(({ href }) => href)).toContain(bazarr);
	});
});

describe('zurg Android has no TorBox hosted NZB backend', () => {
	const reason = 'zurg Android has no TorBox hosted NZB backend; that route needs a normal host.';

	it.each(['webdav', 'external'] as const)(
		'blocks Android when %s plays TorBox hosted NZBs through zurg',
		(player) => {
			const input = answers({ player, sources: ['torbox-hosted'], host: 'android' });

			expect(hostChoiceReason(input, 'android')).toBe(reason);
			expect(recommendSetup(input).conflicts).toContain(reason);
		}
	);

	it.each(['stremio', 'kodi'] as const)(
		'keeps Android open when %s plays TorBox hosted NZBs without zurg',
		(player) => {
			const input = answers({ player, sources: ['torbox-hosted'], host: 'android' });

			expect(hostChoiceReason(input, 'android')).toBeUndefined();
			expect(recommendSetup(input).conflicts).toEqual([]);
		}
	);

	it('says TorBox hosted NZBs are not available in the Android prerequisite', () => {
		expect(
			recommendSetup(answers({ player: 'kodi', sources: ['usenet'], host: 'android' }))
				.prerequisites
		).toContain(
			'zurg Android needs sponsor access, a supported device and background operation; direct Usenet requires 64-bit Android, and TorBox hosted NZBs are not available on Android.'
		);
	});
});

describe('Cast names the account each source needs', () => {
	it.each([
		['real-debrid', 'A Real-Debrid account.'],
		['all-debrid', 'An AllDebrid account.'],
		['torbox', 'A TorBox account.'],
		['premiumize', 'A Premiumize account.'],
		['offcloud', 'An Offcloud account.'],
		['debrid-link', 'A Debrid-Link account.'],
		['easynews', 'An Easynews account.'],
	] as const)('asks Stremio with %s for %s', (source, sentence) => {
		expect(
			recommendSetup(answers({ sources: [source] })).sourceCoverage[0].requirements
		).toEqual([sentence]);
	});
});
