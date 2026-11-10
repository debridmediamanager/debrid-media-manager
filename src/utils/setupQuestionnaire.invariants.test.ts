import { describe, expect, it } from 'vitest';
import { GATEKEEPER_URL } from './gatekeeper';
import {
	HOST_OPTIONS,
	NEED_OPTIONS,
	PLAYER_OPTIONS,
	PLEX_ROUTE_OPTIONS,
	PREFERENCE_OPTIONS,
	SETUP_GUIDE_URL,
	SOURCE_OPTIONS,
	recommendSetup,
	type SetupAnswers,
	type SetupRecommendation,
	type SetupSource,
} from './setupQuestionnaire';

const SOURCES = SOURCE_OPTIONS.map(({ value }) => value).filter((value) => value !== 'none');
const DEBRID: SetupSource[] = [
	'real-debrid',
	'all-debrid',
	'torbox',
	'premiumize',
	'offcloud',
	'debrid-link',
];
const ALL_NEEDS = NEED_OPTIONS.map(({ value }) => value);

const SOURCE_SETS: SetupSource[][] = [[], ['none']];
SOURCES.forEach((first, index) => {
	SOURCE_SETS.push([first]);
	for (const second of SOURCES.slice(index + 1)) SOURCE_SETS.push([first, second]);
});

const PLAYER_MODES = PLAYER_OPTIONS.flatMap<Pick<SetupAnswers, 'player' | 'plexRoute'>>(
	({ value: player }) =>
		player === 'plex'
			? PLEX_ROUTE_OPTIONS.map(({ value: plexRoute }) => ({ player, plexRoute }))
			: [{ player }]
);

const NOTES = 'https://notes.debridmediamanager.com/';
const ALLOWED_HREFS = new Set([
	'/stremio',
	'/stremio-alldebrid',
	'/stremio-torbox',
	'/stremio-premiumize',
	'/stremio-offcloud',
	'/stremio-debridlink',
	'/stremio-easynews',
	'/settings',
	'/wanted',
	'/transfers',
	'/torznab',
	'/newznab',
	'/sabnzbd',
	'/kodi',
	'/jellyfin',
	'/emby',
	'/api-docs',
	GATEKEEPER_URL,
	// The zurg nightly benefit links the zurg site, where sponsors download it.
	'https://zurg.debridmediamanager.com/',
	SETUP_GUIDE_URL,
	`${SETUP_GUIDE_URL}#usenet-without-a-usenet-account-which-route`,
	...[
		'zurg/setup',
		'zurg/guides/stremio',
		'zurg/providers/torbox-nzb',
		'zurg/guides/sonarr-radarr-torrents',
		'zurg/guides/sonarr-radarr',
		'zurg/guides/acquisition',
		'zurg/guides/dmm-wanted',
		'zurg/guides/android',
		'zurg/guides/subtitles',
		'rex/with-zurg',
		'rex/any-source',
		'rex/stremio',
		'rex/faq',
		'rex/from-plex',
		'dmm/seerr',
		'guides/remote-help',
	].map((path) => `${NOTES}${path}/`),
	`${NOTES}zurg/guides/dmm-wanted/#two-zurgs-on-one-key`,
]);

/** Visits every string and every list in the result, with its path for failure messages. */
function walk(
	value: unknown,
	path: string,
	onString: (text: string, path: string) => void,
	onList: (list: unknown[], path: string) => void
) {
	if (typeof value === 'string') onString(value, path);
	else if (Array.isArray(value)) {
		onList(value, path);
		value.forEach((item, index) => walk(item, `${path}[${index}]`, onString, onList));
	} else if (value && typeof value === 'object')
		for (const [key, item] of Object.entries(value))
			walk(item, `${path}.${key}`, onString, onList);
}

function check(answers: SetupAnswers, result: SetupRecommendation) {
	const where = JSON.stringify(answers);
	const fail = (reason: string) => {
		throw new Error(`${reason}; answers=${where}`);
	};
	const selected = answers.sources.filter((source) => source !== 'none');

	if ((result.primaryRoute.id === 'resolve-constraints') !== result.conflicts.length > 0)
		fail('resolve-constraints and conflicts disagree');
	if (
		result.hostRequirement === 'none' &&
		result.conflicts.some((conflict) => /\bhosts?\b|\bmachines?\b/i.test(conflict))
	)
		fail('a route without a host requirement has a host conflict');
	if (result.hostRequirement !== 'none' && answers.host === 'none' && !result.conflicts.length)
		fail('a route that needs a host has no conflict for "No host"');
	// zurg+rex Android runs zurg and the rex zurg feeds, never arr, a mounted server or another rex feed.
	const zurgRex =
		answers.player === 'plex' &&
		(answers.plexRoute === 'rex' || answers.plexRoute === 'either') &&
		answers.preference !== 'arr' &&
		!selected.some((source) => source === 'url-addon' || source === 'http-local');
	if (
		result.hostRequirement === 'server' &&
		answers.host === 'android' &&
		!result.conflicts.length &&
		!zurgRex
	)
		fail('a full-server route has no conflict for Android');
	if (
		answers.host === 'android' &&
		zurgRex &&
		result.conflicts.some((conflict) => /full server host|normal host for rex/.test(conflict))
	)
		fail('zurg+rex Android has a conflict as if it could not run rex');

	const covered = result.sourceCoverage.map(({ source }) => source);
	if (covered.length !== selected.length || selected.some((source) => !covered.includes(source)))
		fail('source coverage is not one entry per selected source');

	for (const { source, requirements } of result.sourceCoverage)
		for (const requirement of requirements)
			if (!requirement.endsWith('.'))
				fail(`the ${source} requirement "${requirement}" is not a full sentence`);

	walk(
		result,
		'result',
		(text, path) => {
			if (/undefined|null|\[object/.test(text)) fail(`${path} reads "${text}"`);
			if (path.endsWith('.href') && !ALLOWED_HREFS.has(text))
				fail(`${path} links outside the allowlist: ${text}`);
		},
		(list, path) => {
			const keys = list.map((item) => JSON.stringify(item));
			if (new Set(keys).size !== keys.length) fail(`${path} repeats an entry`);
		}
	);

	const usesZurg = result.sourceCoverage.some(
		({ status, integration }) => status === 'integrated' && / → zurg → /.test(integration)
	);
	const acquires =
		answers.preference === 'arr' &&
		selected.some(
			(source) => DEBRID.includes(source) || source === 'usenet' || source === 'torbox-hosted'
		);
	const zurgRequired = result.sponsorship.required.some(({ id }) => id === 'zurg-nightly');
	if (zurgRequired !== (usesZurg || acquires))
		fail(`zurg-nightly required=${zurgRequired} but zurg route=${usesZurg}, arr=${acquires}`);

	const rexStremioKey = [...result.sponsorship.required, ...result.sponsorship.optional].some(
		({ id }) => id === 'rex-stremio-key'
	);
	const rexStremioFree = result.sponsorship.freeFeatures.includes('rex-stremio');
	// On Android rex comes inside the sponsor-only zurg+rex app, so nothing of rex is named free there.
	if (rexStremioFree !== (rexStremioKey && answers.host !== 'android'))
		fail(
			`rex-stremio-key offered=${rexStremioKey} but rex-stremio free=${rexStremioFree} on host ${answers.host}`
		);

	if (selected.length === 1 && selected[0] === 'easynews') {
		const offered = [...result.sponsorship.required, ...result.sponsorship.optional].map(
			({ id }) => id
		);
		for (const id of ['zurg-nightly', 'zurg-api-key', 'wanted', 'wanted-kodi'])
			if (offered.includes(id)) fail(`Easynews alone is offered ${id}`);
	}
}

describe('setup recommendation invariants', () => {
	it('hold for every player, host and workflow with up to two sources', () => {
		let cases = 0;
		for (const mode of PLAYER_MODES)
			for (const sources of SOURCE_SETS)
				for (const { value: host } of HOST_OPTIONS)
					for (const { value: preference } of PREFERENCE_OPTIONS) {
						const base: SetupAnswers = {
							...mode,
							sources,
							host,
							preference,
							needs: [],
						};
						const withNeeds: SetupAnswers = { ...base, needs: ALL_NEEDS };
						const plain = recommendSetup(base);
						const needy = recommendSetup(withNeeds);
						check(base, plain);
						check(withNeeds, needy);
						const stable = (result: SetupRecommendation) =>
							JSON.stringify([
								result.primaryRoute,
								result.conflicts,
								result.hostRequirement,
							]);
						if (stable(plain) !== stable(needy))
							throw new Error(
								`needs changed the route, conflicts or host; answers=${JSON.stringify(base)}`
							);
						cases += 1;
					}
		expect(cases).toBe(PLAYER_MODES.length * SOURCE_SETS.length * 4 * 4);
	});
});

describe('setup copy and benefits for every combination of up to two sources', () => {
	const cases = PLAYER_MODES.flatMap((mode) =>
		SOURCE_SETS.flatMap((sources) =>
			HOST_OPTIONS.flatMap(({ value: host }) =>
				PREFERENCE_OPTIONS.flatMap(({ value: preference }) =>
					[[], ALL_NEEDS].map((needs) => {
						const answers: SetupAnswers = { ...mode, sources, host, preference, needs };
						return { answers, result: recommendSetup(answers) };
					})
				)
			)
		)
	);
	/** The first few answers that break a rule, so a failure names them. */
	const breaking = (broken: (answers: SetupAnswers, result: SetupRecommendation) => boolean) =>
		cases
			.filter(({ answers, result }) => broken(answers, result))
			.slice(0, 3)
			.map(({ answers }) => JSON.stringify(answers));
	const texts = (result: SetupRecommendation) => {
		const all: string[] = [];
		walk(
			result,
			'result',
			(text) => all.push(text),
			() => undefined
		);
		return all;
	};
	const offered = (result: SetupRecommendation) =>
		[...result.sponsorship.required, ...result.sponsorship.optional].map(({ id }) => id);

	it('combines routes with different titles, counting the Stremio TorBox addon once', () => {
		expect(
			breaking((_, result) => {
				const integrated = result.sourceCoverage.filter(
					({ status }) => status === 'integrated'
				);
				// TorBox's DMM Cast and its TorBox Cast for hosted NZBs are one addon, /stremio-torbox.
				const stremioTorBox =
					integrated.some(({ source }) => source === 'torbox') &&
					integrated.some(
						({ source, integration }) =>
							source === 'torbox-hosted' &&
							integration.endsWith('TorBox Cast → Stremio')
					);
				return (
					new Set(integrated.map(({ integration }) => integration)).size > 1 &&
					!stremioTorBox &&
					!['combined-sources', 'arr-zurg', 'resolve-constraints'].includes(
						result.primaryRoute.id
					)
				);
			})
		).toEqual([]);
	});

	it('gives the same result whatever order two sources were picked in', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.sources.length === 2 &&
					JSON.stringify(
						recommendSetup({ ...answers, sources: [...answers.sources].reverse() })
					) !== JSON.stringify(result)
			)
		).toEqual([]);
	});

	it('offers no TorBox WebDAV beside TorBox hosted NZBs', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.sources.includes('torbox-hosted') &&
					[
						...result.conflicts,
						...result.alternatives.flatMap(({ title, detail }) => [title, detail]),
						...result.components,
						...result.prerequisites,
						...result.limits,
						...result.sourceCoverage.flatMap(({ integration, requirements }) => [
							integration,
							...requirements,
						]),
					].some((text) => /TorBox WebDAV|webdav\.torbox\.app/.test(text))
			)
		).toEqual([]);
	});

	it('never points at a running zurg when there is no host', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.host === 'none' &&
					texts(result).some((text) =>
						/the zurg your Usenet account runs on|that zurg|those zurgs/.test(text)
					)
			)
		).toEqual([]);
	});

	it('links two zurgs on one DMM key exactly when two zurgs are needed', () => {
		expect(
			breaking(
				(_, result) =>
					result.prerequisites.some((text) =>
						text.includes('separate zurg instances')
					) !==
					result.setupLinks.some(({ href }) => href.endsWith('#two-zurgs-on-one-key'))
			)
		).toEqual([]);
	});

	it('links Settings for the ten-stream perk only when a Cast page is Real-Debrid, TorBox or AllDebrid', () => {
		// Settings' other-streams selector writes only these Cast profiles; TorBox Pro uses TorBox's.
		const settingsProfiles: SetupSource[] = [
			'real-debrid',
			'torbox',
			'all-debrid',
			'torbox-hosted',
		];
		const castRoute =
			/^(?:DMM Cast → Stremio|TorBox hosted NZBs → TorBox Cast → Stremio|DMM Kodi addon → your account)$/;
		expect(
			breaking(
				(_, result) =>
					[...result.sponsorship.required, ...result.sponsorship.optional].some(
						({ id, href }) => id === 'cast-streams' && href === '/settings'
					) &&
					!result.sourceCoverage.some(
						({ source, status, integration }) =>
							status === 'integrated' &&
							castRoute.test(integration) &&
							settingsProfiles.includes(source)
					)
			)
		).toEqual([]);
	});

	it('says no DMM tool is used when every route only reaches what the user already has', () => {
		// The titles of provider-webdav, *-existing-library and existing-url-addon-stremio routes.
		const noTool =
			/^(?:[\w-]+ WebDAV → your WebDAV or SMB player|Keep .+ for local or HTTP files|Keep your existing Stremio URL addons)$/;
		expect(
			breaking(
				(_, result) =>
					result.sponsorship.usesDmmTools &&
					result.sourceCoverage
						.filter(({ status }) => status === 'integrated')
						.every(({ integration }) => noTool.test(integration))
			)
		).toEqual([]);
	});

	it('names players with a lowercase article mid-sentence', () => {
		expect(
			breaking((_, result) =>
				texts(result).some(
					(text) =>
						text.includes('An external player') ||
						text.includes('in WebDAV or SMB player') ||
						text.includes('your network player') ||
						/\byour (Kodi|Jellyfin|Emby)\b/.test(text)
				)
			)
		).toEqual([]);
	});

	it('offers no zurg-only benefit when nothing runs zurg and there is no host', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.host === 'none' &&
					!result.components.some((component) => /zurg/i.test(component)) &&
					offered(result).some((id) =>
						['zurg-api-key', 'wanted', 'wanted-kodi', 'seerr'].includes(id)
					)
			)
		).toEqual([]);
	});

	it('suggests DMM Wanted or Seerr only with a debrid or NZB backend', () => {
		expect(
			breaking(
				(answers, result) =>
					result.alternatives.some(({ title }) =>
						/^DMM Wanted( or Seerr)? requests$/.test(title)
					) &&
					!answers.sources.some(
						(source) =>
							DEBRID.includes(source) ||
							source === 'usenet' ||
							source === 'torbox-hosted'
					)
			)
		).toEqual([]);
	});

	it('offers Seerr only with a Plex, Jellyfin or Emby server', () => {
		expect(
			breaking((answers, result) => {
				const server =
					(answers.player === 'plex' && answers.plexRoute !== 'rex') ||
					answers.player === 'jellyfin' ||
					answers.player === 'emby';
				return (
					!server &&
					(offered(result).includes('seerr') ||
						texts(result).some((text) => /seerr/i.test(text)))
				);
			})
		).toEqual([]);
	});

	it('never offers Seerr on Android, where no media server runs', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.host === 'android' &&
					(offered(result).includes('seerr') ||
						texts(result).some((text) => text.includes('dmm/seerr')))
			)
		).toEqual([]);
	});

	it('names nothing of rex free on Android, where rex comes inside the sponsor-only app', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.host === 'android' &&
					answers.player === 'plex' &&
					(answers.plexRoute === 'rex' || answers.plexRoute === 'either') &&
					(result.sponsorship.freeFeatures.some(
						(feature) => feature === 'rex' || feature === 'rex-stremio'
					) ||
						texts(result).some((text) => /not require sponsorship/.test(text)))
			)
		).toEqual([]);
	});

	it('suggests Bazarr only for Sonarr/Radarr, whose imports it works from', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.preference !== 'arr' &&
					texts(result).some(
						(text) => /Bazarr can/.test(text) || text.includes('zurg/guides/subtitles')
					)
			)
		).toEqual([]);
	});

	it('names no TorBox Cast to Kodi and no no-host route to a media server', () => {
		expect(
			breaking((answers, result) =>
				result.conflicts.some(
					(conflict) =>
						(answers.player === 'kodi' && conflict.includes('TorBox Cast')) ||
						(['plex', 'jellyfin', 'emby'].includes(answers.player) &&
							/which needs? no host/.test(conflict))
				)
			)
		).toEqual([]);
	});

	it('never offers Wanted or Seerr without the zurg that fetches for them', () => {
		expect(
			breaking(
				(_, result) =>
					offered(result).some((id) => ['wanted', 'wanted-kodi', 'seerr'].includes(id)) &&
					!offered(result).includes('zurg-nightly')
			)
		).toEqual([]);
	});

	it('never offers Wanted or Seerr on Android without a source zurg Android can fetch with', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.host === 'android' &&
					!result.components.some((component) => /zurg/i.test(component)) &&
					!answers.sources.some(
						(source) => DEBRID.includes(source) || source === 'usenet'
					) &&
					(offered(result).some((id) =>
						['wanted', 'wanted-kodi', 'seerr'].includes(id)
					) ||
						result.alternatives.some(({ title }) => title.startsWith('DMM Wanted')))
			)
		).toEqual([]);
	});

	it('warns about Real-Debrid’s one public IP only when Real-Debrid is selected', () => {
		expect(
			breaking(
				(answers, result) =>
					!answers.sources.includes('real-debrid') &&
					texts(result).some((text) => text.includes('Real-Debrid use must stay on one'))
			)
		).toEqual([]);
	});

	it('never says AllDebrid has no WebDAV', () => {
		expect(
			breaking((_, result) =>
				texts(result).some((text) => /AllDebrid has no WebDAV/.test(text))
			)
		).toEqual([]);
	});

	it('never answers remote playback with hosted Cast for a media server or rex', () => {
		expect(
			breaking(
				(answers, result) =>
					['plex', 'jellyfin', 'emby'].includes(answers.player) &&
					result.optionalNeeds.some((need) => need.startsWith('Hosted Cast'))
			)
		).toEqual([]);
	});

	it("never brings back the generic 'A supported provider account or Easynews account.' wording", () => {
		expect(
			breaking((_, result) =>
				texts(result).includes('A supported provider account or Easynews account.')
			)
		).toEqual([]);
	});

	it('labels every link to the setup guide "Read the full setup guide"', () => {
		expect(
			breaking((_, result) =>
				[
					...result.setupLinks,
					...result.sourceCoverage.flatMap(({ setupLinks }) => setupLinks),
					...result.alternatives.flatMap(({ links }) => links),
				].some(
					({ label, href }) =>
						href === SETUP_GUIDE_URL && label !== 'Read the full setup guide'
				)
			)
		).toEqual([]);
	});

	const hostedNzbThroughZurg = (result: SetupRecommendation) =>
		result.components.some((component) => component.includes('hosted NZB backend'));

	it('never leaves a zurg hosted NZB route on Android without a conflict', () => {
		expect(
			breaking(
				(answers, result) =>
					answers.host === 'android' &&
					hostedNzbThroughZurg(result) &&
					!result.conflicts.length
			)
		).toEqual([]);
	});

	it('never offers an Android device for a zurg hosted NZB route', () => {
		expect(
			breaking(
				(_, result) =>
					hostedNzbThroughZurg(result) &&
					result.conflicts.some((conflict) =>
						conflict.includes('supported Android device')
					)
			)
		).toEqual([]);
	});

	it("never brings back the generic no-host 'Cast/direct-player' wording", () => {
		expect(
			breaking((_, result) =>
				result.conflicts.some((conflict) => conflict.includes('Cast/direct-player'))
			)
		).toEqual([]);
	});
});
