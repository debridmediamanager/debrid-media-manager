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
	if (
		result.hostRequirement === 'server' &&
		answers.host === 'android' &&
		!result.conflicts.length
	)
		fail('a full-server route has no conflict for Android');

	const covered = result.sourceCoverage.map(({ source }) => source);
	if (covered.length !== selected.length || selected.some((source) => !covered.includes(source)))
		fail('source coverage is not one entry per selected source');

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

	it('names players with a lowercase article mid-sentence', () => {
		expect(
			breaking((_, result) =>
				texts(result).some(
					(text) =>
						text.includes('An external player') ||
						text.includes('in WebDAV or SMB player')
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

	it('never says AllDebrid has no WebDAV', () => {
		expect(
			breaking((_, result) =>
				texts(result).some((text) => /AllDebrid has no WebDAV/.test(text))
			)
		).toEqual([]);
	});

	it('names a no-host route that exists instead of a generic one', () => {
		expect(
			breaking((_, result) =>
				result.conflicts.some((conflict) => conflict.includes('Cast/direct-player'))
			)
		).toEqual([]);
	});
});
