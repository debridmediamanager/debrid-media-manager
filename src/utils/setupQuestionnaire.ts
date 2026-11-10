export const SETUP_GUIDE_URL = 'https://notes.debridmediamanager.com/guides/choose-your-setup/';

export const PLAYER_OPTIONS = [
	{
		value: 'stremio',
		label: 'Stremio',
		description: 'I want an addon that can play titles on this device.',
	},
	{
		value: 'kodi',
		label: 'Kodi',
		description: 'I browse and play from Kodi.',
	},
	{
		value: 'plex',
		label: 'Plex apps',
		description: 'I watch through Plex on one or more devices.',
	},
	{
		value: 'jellyfin',
		label: 'Jellyfin',
		description: 'Jellyfin is already my media server.',
	},
	{
		value: 'emby',
		label: 'Emby',
		description: 'Emby is already my media server.',
	},
	{
		value: 'webdav',
		label: 'WebDAV or SMB player',
		description: 'My player reads a network library or share.',
	},
	{
		value: 'external',
		label: 'An external player',
		description: 'I usually open one file in a player of my choice.',
	},
	{
		value: 'unsure',
		label: 'I am not sure yet',
		description: 'Help me choose a simple starting point.',
	},
] as const;

export type Player = (typeof PLAYER_OPTIONS)[number]['value'];

export const SOURCE_OPTIONS = [
	{
		value: 'real-debrid',
		label: 'Real-Debrid',
		description: 'A debrid account for torrents and cached releases.',
	},
	{
		value: 'all-debrid',
		label: 'AllDebrid',
		description: 'A debrid account for torrents and cached releases.',
	},
	{
		value: 'torbox',
		label: 'TorBox',
		description: 'A TorBox account for torrents or its supported libraries.',
	},
	{
		value: 'premiumize',
		label: 'Premiumize',
		description: 'A Premiumize account for torrents and cloud files.',
	},
	{
		value: 'offcloud',
		label: 'Offcloud',
		description: 'An Offcloud account for supported cloud files.',
	},
	{
		value: 'debrid-link',
		label: 'Debrid-Link',
		description: 'A Debrid-Link account for supported releases.',
	},
	{
		value: 'easynews',
		label: 'Easynews',
		description: 'An Easynews web account for direct HTTP files.',
	},
	{
		value: 'usenet',
		label: 'My own Usenet / NNTP account',
		description: 'News-server credentials I control.',
	},
	{
		value: 'torbox-hosted',
		label: 'TorBox Pro hosted NZBs',
		description: 'I want TorBox to fetch and repair NZBs for me.',
	},
	{
		value: 'url-addon',
		label: 'Existing Stremio URL addons',
		description: 'Stremio addons that already return playable HTTP streams.',
	},
	{
		value: 'http-local',
		label: 'HTTP links or files on a disk/NAS',
		description: 'I already have media bytes somewhere I can reach.',
	},
	{
		value: 'none',
		label: 'None yet / I am unsure',
		description: 'Show me which accounts work with my player.',
	},
] as const;

export type SetupSource = (typeof SOURCE_OPTIONS)[number]['value'];

export const HOST_OPTIONS = [
	{
		value: 'existing',
		label: 'An existing server or host',
		description: 'A machine can stay on while I watch.',
	},
	{
		value: 'willing',
		label: 'I can run a host',
		description: 'I am willing to run a small service or server.',
	},
	{
		value: 'android',
		label: 'The Android / Google TV device itself',
		description: 'It is a supported device and can stay awake while I watch.',
	},
	{
		value: 'none',
		label: 'No host',
		description: 'I want a hosted or direct route with no machine to maintain.',
	},
] as const;

export type Host = (typeof HOST_OPTIONS)[number]['value'];

export const PREFERENCE_OPTIONS = [
	{
		value: 'on-demand',
		label: 'Choose and play as I go',
		description: 'I do not need a library prepared in advance.',
	},
	{
		value: 'managed',
		label: 'A managed library',
		description: 'I want titles organised and available across devices.',
	},
	{
		value: 'arr',
		label: 'Automation with Sonarr/Radarr',
		description: 'I want quality profiles, monitoring and automatic acquisition.',
	},
	{
		value: 'unsure',
		label: 'I am not sure yet',
		description: 'Show me the least complicated route first.',
	},
] as const;

export type Preference = (typeof PREFERENCE_OPTIONS)[number]['value'];

export const NEED_OPTIONS = [
	{
		value: 'remote',
		label: 'Watch away from home',
	},
	{
		value: 'family',
		label: 'Share with family or several homes',
	},
	{
		value: 'offline',
		label: 'Keep real offline copies',
	},
	{
		value: 'subtitles',
		label: 'Automatic subtitle help',
	},
	{
		value: 'mixed',
		label: 'Mix local files with cloud titles',
	},
] as const;

export type Need = (typeof NEED_OPTIONS)[number]['value'];

export const PLEX_ROUTE_OPTIONS = [
	{
		value: 'existing-server',
		label: 'Keep my existing Plex Media Server',
		description: 'Keep its libraries, clients and existing workflow.',
	},
	{
		value: 'rex',
		label: 'Use rex for Plex apps',
		description: 'I prefer a library route without a mounted Plex server.',
	},
	{
		value: 'either',
		label: 'Show me both',
		description: 'I can choose after I see the tradeoffs.',
	},
] as const;

export type PlexRoute = (typeof PLEX_ROUTE_OPTIONS)[number]['value'];

export interface SetupAnswers {
	player: Player;
	plexRoute?: PlexRoute;
	sources: SetupSource[];
	host: Host;
	preference: Preference;
	needs: Need[];
}

export interface SetupLink {
	label: string;
	href: string;
}

export interface SetupAlternative {
	title: string;
	detail: string;
	links: SetupLink[];
}

export type HostRequirement = 'none' | 'zurg' | 'server';

export interface SetupSourceCoverage {
	source: SetupSource;
	label: string;
	status: 'integrated' | 'separate';
	integration: string;
	requirements: string[];
	setupLinks: SetupLink[];
}

export interface SetupSponsorBenefit {
	id: string;
	title: string;
	detail: string;
	href?: string;
}

export type FreeSponsorFeature = 'cast' | 'rex' | 'rex-stremio';

export interface SetupSponsorship {
	required: SetupSponsorBenefit[];
	optional: SetupSponsorBenefit[];
	freeFeatures: FreeSponsorFeature[];
	routeAvailable: boolean;
	/** A route uses DMM, zurg or rex, not only files, addons or provider WebDAV the user already has. */
	usesDmmTools: boolean;
	/** A benefit for the selected accounts is listed; today only uploader priority, for Real-Debrid. */
	hasAccount: boolean;
}

export interface SetupRecommendation {
	primaryRoute: {
		id: string;
		title: string;
		summary: string;
	};
	whyMatched: string[];
	components: string[];
	prerequisites: string[];
	limits: string[];
	setupLinks: SetupLink[];
	alternatives: SetupAlternative[];
	optionalNeeds: string[];
	conflicts: string[];
	sourceNotes: string[];
	sourceCoverage: SetupSourceCoverage[];
	hostRequirement: HostRequirement;
	sponsorship: SetupSponsorship;
}

const FULL_HOST_PLAYERS: Player[] = ['plex', 'jellyfin', 'emby'];

export function playerNeedsFullHost(player: Player): boolean {
	return FULL_HOST_PLAYERS.includes(player);
}

/** Seerr is set up against a Plex, Jellyfin or Emby server; rex is not one, and an Android host runs none. */
function seerrFits(player: Player, plexRoute: PlexRoute | undefined, host: Host): boolean {
	return (
		host !== 'android' &&
		(player === 'plex' ? plexRoute !== 'rex' : player === 'jellyfin' || player === 'emby')
	);
}

function playerLabel(player: Player): string {
	return PLAYER_OPTIONS.find((option) => option.value === player)?.label ?? player;
}

/** How each player reads in the middle of a sentence. */
const PLAYER_PHRASES: Record<Exclude<Player, 'unsure'>, string> = {
	stremio: 'Stremio',
	kodi: 'Kodi',
	plex: 'Plex apps',
	jellyfin: 'Jellyfin',
	emby: 'Emby',
	webdav: 'your WebDAV or SMB player',
	external: 'your external player',
};

/** The accounts each player can use, for someone who has none yet. */
const ACCOUNTS_FOR_PLAYER: Record<Exclude<Player, 'unsure'>, string> = {
	stremio:
		'A debrid or Easynews account works through DMM Cast with no host; TorBox Pro hosted NZBs through TorBox Cast; your own Usenet account needs zurg on a host.',
	kodi: 'A debrid, Easynews or TorBox Pro account works through the Kodi addon with no host; your own Usenet account needs zurg on a host.',
	external:
		'A debrid or Easynews account works through DMM Watch with no host; your own Usenet account needs zurg on a host. TorBox Pro hosted NZBs need zurg on a normal host, not Android.',
	webdav: 'Real-Debrid, AllDebrid, Premiumize, TorBox and Debrid-Link serve their own WebDAV with no host; Offcloud and Usenet need zurg on a host. TorBox Pro hosted NZBs need zurg on a normal host, not Android.',
	plex: 'Any debrid account or your own Usenet account works through zurg on a host; files you already have stay in the server. TorBox Pro hosted NZBs work through zurg on a host too.',
	jellyfin:
		'Any debrid account works through a provider plugin or zurg on a host; your own Usenet account through the NZB plugin or zurg; files you already have stay in the server. TorBox Pro hosted NZBs work through zurg on a host too.',
	emby: 'Any debrid account works through a provider plugin or zurg on a host; your own Usenet account through zurg; files you already have stay in the server. TorBox Pro hosted NZBs work through zurg on a host too.',
};
const REX_ACCOUNTS =
	'Any debrid or Usenet account works through zurg → rex on a host; Stremio URL addons through rex-stremio; local files need a feed producer. TorBox Pro hosted NZBs work through zurg on a host too.';
const REX_ANDROID_ACCOUNTS =
	'Any debrid account or your own Usenet account works through zurg → rex on the device; Stremio URL addons, local files and TorBox Pro hosted NZBs need rex or zurg on a normal host.';

/** "A", "A or B", "A, B or C". */
const orList = (names: string[]) =>
	names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];

const DEBRID_SOURCES: SetupSource[] = [
	'real-debrid',
	'all-debrid',
	'torbox',
	'premiumize',
	'offcloud',
	'debrid-link',
];

/** The player a route is built for; an undecided player gets a starting option. */
function resolvePlayer({
	player,
	sources,
}: Pick<SetupAnswers, 'player' | 'sources'>): Exclude<Player, 'unsure'> {
	if (player !== 'unsure') return player;
	// Own Usenet alone: zurg → a WebDAV player needs no indexer, unlike the Stremio NZB search addon.
	const usenetOnly =
		sources.includes('usenet') &&
		!sources.some(
			(source) =>
				DEBRID_SOURCES.includes(source) ||
				source === 'easynews' ||
				source === 'url-addon' ||
				source === 'torbox-hosted'
		);
	// Anything Cast or a Stremio addon plays starts on Stremio; files alone in an external player.
	return usenetOnly
		? 'webdav'
		: sources.includes('http-local') && sources.every((source) => source === 'http-local')
			? 'external'
			: 'stremio';
}

const ANDROID_HOSTED_NZB =
	'zurg+rex Android has no TorBox hosted NZB backend; that route needs a normal host.';

/** zurg+rex Android runs zurg and the rex zurg feeds, never a mounted server, rex-stremio or another feed. */
function runsOnAndroid(r: SourceRoute): boolean {
	return r.host !== 'server' || (!!r.usesZurg && !!r.usesRex);
}

/** Plex apps on rex that zurg+rex Android runs: zurg feeds it from a debrid account or own
 * Usenet, never arr, URL addons, HTTP files or TorBox hosted NZBs. */
function androidRunsRex({
	player,
	plexRoute,
	sources,
	host,
	preference,
}: Pick<SetupAnswers, 'player' | 'plexRoute' | 'sources' | 'host' | 'preference'>): boolean {
	return (
		player === 'plex' &&
		(plexRoute === 'rex' || plexRoute === 'either') &&
		host === 'android' &&
		preference !== 'arr' &&
		sources.some((source) => DEBRID_SOURCES.includes(source) || source === 'usenet') &&
		!sources.some((source) => ['url-addon', 'http-local', 'torbox-hosted'].includes(source))
	);
}

/** Shared by the host choices and defensive recommendation validation. */
export function hostChoiceReason(
	answers: Pick<SetupAnswers, 'player' | 'plexRoute' | 'sources'>,
	host: Host
): string | undefined {
	if (host !== 'android') return undefined;
	const rex =
		answers.player === 'plex' &&
		(answers.plexRoute === 'rex' || answers.plexRoute === 'either');
	if (playerNeedsFullHost(answers.player) && !rex) {
		// zurg Android serves WebDAV and the Files picker, never a mount a server could scan.
		const server =
			answers.player === 'plex' ? 'Plex Media Server' : playerLabel(answers.player);
		return `${server} needs a full server host; zurg+rex Android cannot give a server on that device a library.`;
	}
	if (rex && answers.sources.some((source) => source === 'url-addon' || source === 'http-local'))
		return 'zurg+rex Android feeds rex from zurg only; Stremio URL addons and HTTP files need rex on a normal host.';
	// Stremio and Kodi play TorBox hosted NZBs without zurg; WebDAV, external players and rex need it.
	if (
		answers.sources.includes('torbox-hosted') &&
		(rex || ['webdav', 'external'].includes(resolvePlayer(answers)))
	)
		return ANDROID_HOSTED_NZB;
	return undefined;
}

/** Shared by the workflow choices and defensive recommendation validation. */
export function preferenceChoiceReason(
	answers: Pick<SetupAnswers, 'host' | 'sources'>,
	preference: Preference
): string | undefined {
	if (preference !== 'arr') return undefined;
	const reasons: string[] = [];
	if (answers.host !== 'existing' && answers.host !== 'willing')
		reasons.push('an existing or willing full host for Sonarr/Radarr and zurg');
	if (
		!answers.sources.some(
			(source) =>
				DEBRID_SOURCES.includes(source) || source === 'usenet' || source === 'torbox-hosted'
		)
	)
		reasons.push('a supported debrid or NZB backend');
	if (!reasons.length) return undefined;
	return `The arr workflow needs ${reasons.join(', plus ')}.${
		answers.host !== 'existing' && answers.host !== 'willing'
			? ' Android and no host cannot run this workflow.'
			: ''
	}`;
}

const DMM_CAST_LINKS: Record<string, SetupLink> = {
	'real-debrid': { label: 'DMM Cast for Real-Debrid', href: '/stremio' },
	'all-debrid': { label: 'DMM Cast for AllDebrid', href: '/stremio-alldebrid' },
	torbox: { label: 'DMM Cast for TorBox', href: '/stremio-torbox' },
	premiumize: { label: 'DMM Cast for Premiumize', href: '/stremio-premiumize' },
	offcloud: { label: 'DMM Cast for Offcloud', href: '/stremio-offcloud' },
	'debrid-link': { label: 'DMM Cast for Debrid-Link', href: '/stremio-debridlink' },
	easynews: { label: 'DMM Cast for Easynews', href: '/stremio-easynews' },
};

/** Providers that serve their own WebDAV. Offcloud has none. */
const PROVIDER_WEBDAV: Partial<Record<SetupSource, string>> = {
	'real-debrid': 'https://dav.real-debrid.com/',
	'all-debrid': 'https://webdav.debrid.it/',
	premiumize: 'https://webdav.premiumize.me/',
	torbox: 'https://webdav.torbox.app/',
	'debrid-link': 'https://webdav.debrid.link/',
};

/** Selected providers whose own WebDAV can stand in for a route. TorBox's WebDAV is not known to
 * list hosted NZB downloads, so it cannot stand in beside them. */
const providerWebdav = (selected: SetupSource[]) =>
	selected.filter(
		(source) =>
			PROVIDER_WEBDAV[source] && (source !== 'torbox' || !selected.includes('torbox-hosted'))
	);

const SOURCE_LABELS = new Map<SetupSource, string>(
	SOURCE_OPTIONS.map(({ value, label }) => [value, label])
);

/** A notes page, with an optional `#section` kept after the page's trailing slash. */
const note = (path: string, label: string): SetupLink => {
	const [page, section] = path.split('#');
	return {
		label,
		href: `https://notes.debridmediamanager.com/${page}/${section ? `#${section}` : ''}`,
	};
};
const ZURG = note('zurg/setup', 'zurg setup');
const REX = note('rex/with-zurg', 'rex with zurg');
const HTTP = note('rex/any-source', 'rex with any source');
const ADDON = note('rex/stremio', 'rex with Stremio addons');
const STREMIO = note('zurg/guides/stremio', 'zurg Stremio setup');
const TORBOX_NZB = note('zurg/providers/torbox-nzb', 'zurg TorBox hosted NZB setup');
// Two zurgs with the same dmm_api_key both read the Wanted list and fetch every title twice.
const TWO_ZURGS = note('zurg/guides/dmm-wanted#two-zurgs-on-one-key', 'Two zurgs on one DMM key');
const TWO_ZURGS_WANTED =
	' With dmm_api_key on both, turn the dmm-wanted source off on one, or every Wanted title is fetched twice.';
const JELLYFIN = { label: 'DMM Jellyfin NZB setup', href: '/jellyfin' };
const GUIDE = { label: 'Read the full setup guide', href: SETUP_GUIDE_URL };
const NEWZNAB = { label: 'DMM Newznab setup', href: '/newznab' };

interface SourceRoute {
	id: string;
	title: string;
	summary: string;
	host: HostRequirement;
	components: string[];
	requirements: string[];
	limits: string[];
	links: SetupLink[];
	status: SetupSourceCoverage['status'];
	zurgNzb?: 'direct' | 'hosted';
	usesZurg?: boolean;
	usesCast?: boolean;
	usesRex?: boolean;
}

const SPONSOR_BENEFITS = {
	zurg: {
		id: 'zurg-nightly',
		title: 'zurg nightly access',
		detail: 'Access the current zurg nightly builds, source code, Docker image and Android app for this route.',
		href: 'https://zurg.debridmediamanager.com/',
	},
	zurgKey: {
		id: 'zurg-api-key',
		title: 'zurg with your DMM API key',
		detail: 'Use the key from your sponsorship for exact release naming, placement and __magic__ folders.',
	},
	torznab: {
		id: 'torznab',
		title: 'DMM torrent indexer',
		detail: 'Search DMM as a Torznab indexer from Prowlarr, Sonarr or Radarr, with cached-only feeds for Real-Debrid, AllDebrid, Debrid-Link, TorBox, Premiumize and Offcloud; the last three answer once your TorBox, Premiumize or Offcloud key is linked on the Torznab page.',
		href: '/torznab',
	},
	newznab: {
		id: 'newznab',
		title: 'DMM Usenet indexer',
		detail: "Search DMM as a Newznab indexer from Prowlarr, Sonarr or Radarr, zurg's Stremio addon, or zurg acquisition for Wanted and watchlists.",
		href: '/newznab',
	},
	wanted: {
		id: 'wanted',
		title: 'DMM Wanted list',
		detail: 'Have zurg fetch requested films, shows, new episodes and upgrades for you.',
		href: '/wanted',
	},
	wantedKodi: {
		id: 'wanted-kodi',
		title: 'DMM Wanted from Kodi',
		detail: 'Add a film or show to your DMM Wanted list from the Kodi addon for zurg to fetch; this needs a running zurg host.',
		href: '/kodi',
	},
	seerr: {
		id: 'seerr',
		title: 'Seerr through DMM',
		detail: 'Send Overseerr or Jellyseerr requests to your DMM Wanted list.',
		href: 'https://notes.debridmediamanager.com/dmm/seerr/',
	},
	jellyfin: {
		id: 'jellyfin-plugins',
		title: 'Jellyfin plugins',
		detail: 'Use DMM debrid and Usenet plugins inside Jellyfin without mounting zurg.',
		href: '/jellyfin',
	},
	emby: {
		id: 'emby-plugins',
		title: 'Emby plugins',
		detail: 'Use DMM debrid plugins inside Emby without mounting zurg.',
		href: '/emby',
	},
	cast: {
		id: 'cast-streams',
		title: 'Ten other streams in Cast',
		detail: 'Raise the other-stream limit from five to ten per Cast profile, in Stremio and the Kodi addon.',
		href: '/settings',
	},
	queue: {
		id: 'uploader-priority',
		title: 'Skip the uploader queue',
		detail: "Priority and 2 TB of Usenet a day instead of 300 GB on DMM's hosted NZB uploader, and three torrent jobs at once instead of one on the torrent uploader.",
		href: '/transfers',
	},
	rexStremio: {
		id: 'rex-stremio-key',
		title: 'rex-stremio with your DMM API key',
		detail: 'rex-stremio skips ffprobe for a debrid stream of a torrent DMM already holds a probe of, so those titles reach rex in seconds.',
		href: 'https://notes.debridmediamanager.com/rex/stremio/',
	},
	api: {
		id: 'sponsor-api',
		title: 'Sponsor API',
		detail: 'Use release identification, cached availability, media details and metadata in your own tools.',
		href: '/api-docs',
	},
	remoteHelp: {
		id: 'remote-help',
		title: 'Free remote help',
		detail: 'A helper can fix your zurg or rex setup in your own terminal while you watch.',
		href: 'https://notes.debridmediamanager.com/guides/remote-help/',
	},
	discord: {
		id: 'discord-role',
		title: 'Sponsor role on Discord',
		detail: 'Connect Discord on gatekeeper to receive the sponsor role.',
	},
	sponsorBenefits: {
		id: 'sponsor-benefits',
		title: 'All sponsor benefits',
		detail: 'See the current benefits and connect your sponsorship in DMM settings.',
		href: '/settings',
	},
} satisfies Record<string, SetupSponsorBenefit>;

type SponsorBenefitId = keyof typeof SPONSOR_BENEFITS;

/** A host a zurg can fetch Wanted on; zurg Android has no torbox_nzb backend, so it needs a debrid account or own Usenet. */
function hostRunsZurg({ host, sources }: Pick<SetupAnswers, 'host' | 'sources'>): boolean {
	return (
		host === 'existing' ||
		host === 'willing' ||
		(host === 'android' &&
			sources.some((source) => DEBRID_SOURCES.includes(source) || source === 'usenet'))
	);
}

/** Jellyfin's NZB plugin alone: it reads only its own NZB directory, never the zurg library Wanted fetches into. */
function nzbPluginOnly(
	player: Player,
	sources: SetupSource[],
	routes: { route: SourceRoute }[]
): boolean {
	return (
		player === 'jellyfin' &&
		sources.includes('usenet') &&
		!sources.some((source) => DEBRID_SOURCES.includes(source)) &&
		!routes.some(({ route: r }) => r.usesZurg)
	);
}

function sponsorshipFor(
	answers: SetupAnswers,
	player: Player,
	routes: { source: SetupSource; route: SourceRoute }[],
	routeAvailable: boolean,
	rexStremio: boolean
): SetupSponsorship {
	const selected = new Set(answers.sources.filter((source) => source !== 'none'));
	const debrid = [...selected].some((source) => DEBRID_SOURCES.includes(source));
	const hasNzb = selected.has('usenet') || selected.has('torbox-hosted');
	const usesZurg =
		routes.some(({ route: source }) => source.usesZurg) ||
		(answers.preference === 'arr' && (debrid || hasNzb));
	const usesCast = routes.some(({ route: source }) => source.usesCast);
	const usesRex = routes.some(({ route: source }) => source.usesRex);
	// Wanted, Seerr and Kodi Wanted only do something once a zurg runs somewhere the player reads.
	const zurgRuns =
		(usesZurg || hostRunsZurg(answers)) && !nzbPluginOnly(player, answers.sources, routes);
	// A zurg with an NZB account: on the playback route, or the one Sonarr/Radarr hand NZBs to.
	const zurgNzb =
		routes.some(({ route: source }) => source.zurgNzb) ||
		(answers.preference === 'arr' && hasNzb);
	// An Easynews release sent to zurg is an NZB, so only a zurg with an NZB backend can fetch it.
	const easynewsToZurg = selected.has('easynews') && zurgNzb;
	const wanted = easynewsToZurg
		? {
				...SPONSOR_BENEFITS.wanted,
				detail: `${SPONSOR_BENEFITS.wanted.detail} Easynews releases you send to zurg land here too.`,
			}
		: SPONSOR_BENEFITS.wanted;
	// Each Cast page sets its own profile's limit; Settings writes only Real-Debrid, TorBox and AllDebrid.
	const castPages = new Set(
		routes
			.filter(({ route: r }) => r.usesCast)
			.map(
				({ source }) => DMM_CAST_LINKS[source === 'torbox-hosted' ? 'torbox' : source].href
			)
	);
	const settingsCovers = ['real-debrid', 'torbox', 'all-debrid'].some((source) =>
		castPages.has(DMM_CAST_LINKS[source].href)
	);
	const cast =
		castPages.size === 1
			? { ...SPONSOR_BENEFITS.cast, href: [...castPages][0] }
			: {
					...SPONSOR_BENEFITS.cast,
					// Routes come in SOURCE_OPTIONS order, so the first page is the first Cast source.
					href: settingsCovers ? SPONSOR_BENEFITS.cast.href : [...castPages][0],
					detail: `${SPONSOR_BENEFITS.cast.detail} Set it on each provider's Cast page${settingsCovers ? '; Settings covers Real-Debrid, TorBox and AllDebrid' : ''}.`,
				};
	const benefits = { ...SPONSOR_BENEFITS, wanted, cast };
	const required: SetupSponsorBenefit[] = [];
	const optional: SetupSponsorBenefit[] = [];
	const add = (list: SetupSponsorBenefit[], id: SponsorBenefitId) => list.push(benefits[id]);

	if (usesZurg) add(required, 'zurg');
	if (player === 'jellyfin' && answers.preference !== 'arr' && (debrid || selected.has('usenet')))
		add(required, 'jellyfin');
	if (player === 'emby' && answers.preference !== 'arr' && debrid) add(required, 'emby');

	if (usesZurg) add(optional, 'zurgKey');
	if (usesCast) add(optional, 'cast');
	if (answers.preference === 'arr' && debrid) add(optional, 'torznab');
	// zurg acquisition searches Newznab with either NZB backend; TorBox Cast and the Kodi addon do not.
	// Sonarr/Radarr handing NZBs to DMM's SABnzbd endpoint for Real-Debrid still search an indexer.
	if (zurgNzb || (answers.preference === 'arr' && selected.has('real-debrid')))
		add(optional, 'newznab');
	if (player === 'jellyfin' && answers.preference === 'arr' && (debrid || selected.has('usenet')))
		add(optional, 'jellyfin');
	if (player === 'emby' && answers.preference === 'arr' && debrid) add(optional, 'emby');
	if (player === 'kodi' && (debrid || hasNzb) && zurgRuns) add(optional, 'wantedKodi');
	const seerr = seerrFits(player, answers.plexRoute, answers.host);
	if (
		zurgRuns &&
		(answers.preference === 'managed' || answers.preference === 'arr') &&
		(debrid || hasNzb)
	) {
		add(optional, 'wanted');
		if (seerr) add(optional, 'seerr');
	}
	const familyOrRemote = answers.needs.includes('family') || answers.needs.includes('remote');
	const supportsRequests = usesZurg || answers.preference === 'managed' || player === 'kodi';
	if (zurgRuns && familyOrRemote && supportsRequests && (debrid || hasNzb)) {
		add(optional, 'wanted');
		if (seerr) add(optional, 'seerr');
	}
	// Easynews sends come from DMM's website, whatever the player; the zurg route already adds the rest.
	if (easynewsToZurg) add(optional, 'wanted');
	// Wanted and Seerr requests are fetched by a zurg with your DMM API key, which this playback route may not run.
	if (!usesZurg && optional.some(({ id }) => ['wanted', 'wanted-kodi', 'seerr'].includes(id))) {
		const requests = optional.some(({ id }) => id === 'seerr')
			? 'Wanted and Seerr requests'
			: 'Wanted requests';
		optional.push({
			...SPONSOR_BENEFITS.zurg,
			detail: SPONSOR_BENEFITS.zurg.detail.replace('this route', requests),
		});
		add(optional, 'zurgKey');
	}
	if (selected.has('real-debrid')) add(optional, 'queue');
	if (rexStremio) add(optional, 'rexStremio');
	if (usesZurg || usesRex) add(optional, 'api');
	// Remote help runs in a terminal, which an Android device running zurg itself does not have.
	const terminal =
		answers.host !== 'android' || routes.some(({ route: source }) => !runsOnAndroid(source));
	if ((usesZurg || usesRex) && terminal) add(optional, 'remoteHelp');
	if (!routeAvailable || !required.length) add(optional, 'sponsorBenefits');
	add(optional, 'discord');

	const unique = (list: SetupSponsorBenefit[]) =>
		list.filter((benefit, index) => list.findIndex((item) => item.id === benefit.id) === index);
	const requiredBenefits = unique(required);
	const requiredIds = new Set(requiredBenefits.map((benefit) => benefit.id));
	const optionalBenefits = unique(optional).filter((benefit) => !requiredIds.has(benefit.id));
	return {
		required: requiredBenefits,
		optional: optionalBenefits,
		// On Android rex comes inside the sponsor-only zurg+rex app, so nothing of rex is named free there.
		freeFeatures: [
			...(usesCast ? (['cast'] as const) : []),
			...(usesRex && answers.host !== 'android' ? (['rex'] as const) : []),
			...(rexStremio && answers.host !== 'android' ? (['rex-stremio'] as const) : []),
		],
		routeAvailable,
		usesDmmTools: routes.some(
			({ route: r }) =>
				r.status === 'integrated' &&
				!r.id.endsWith('-existing-library') &&
				r.id !== 'existing-url-addon-stremio' &&
				r.id !== 'provider-webdav'
		),
		hasAccount: [...requiredBenefits, ...optionalBenefits].some(
			({ id }) => id === SPONSOR_BENEFITS.queue.id
		),
	};
}
/** A route this player can use with the selected sources and no host; empty when there is none. */
function noHostClause(player: Player, selected: SetupSource[], undecided: boolean): string {
	const accounts = selected.filter(
		(source) => DEBRID_SOURCES.includes(source) || source === 'easynews'
	);
	const account = accounts.length > 0;
	const hosted = selected.includes('torbox-hosted');
	const usenet = selected.includes('usenet');
	/** "your Real-Debrid account", or "your Real-Debrid or Easynews accounts" for several. */
	const yours = (sources: SetupSource[]) => {
		// TorBox Pro is the TorBox account that also hosts NZBs, so it is named once.
		const names = sources
			.filter((source) => source !== 'torbox' || !sources.includes('torbox-hosted'))
			.map((source) =>
				source === 'torbox-hosted' ? 'TorBox Pro' : SOURCE_LABELS.get(source)!
			);
		return names.length > 1 ? `your ${orList(names)} accounts` : `your ${names[0]} account`;
	};
	// DMM Cast (TorBox Cast is its TorBox addon) and the Kodi addon also play TorBox Pro hosted NZBs.
	const cast = selected.filter(
		(source) => accounts.includes(source) || source === 'torbox-hosted'
	);
	if (player === 'stremio')
		return account
			? `, or use DMM Cast with ${yours(cast)}, which needs no host`
			: hosted
				? ', or use TorBox Cast, which needs no host'
				: usenet
					? ", or switch to TorBox hosted NZBs through TorBox Cast, or to DMM's Real-Debrid transfer, which need no host"
					: '';
	if (player === 'kodi')
		return cast.length
			? `, or use the Kodi addon with ${yours(cast)}, which needs no host`
			: usenet
				? ", or switch to TorBox hosted NZBs through the Kodi addon, or to DMM's Real-Debrid transfer, which need no host"
				: '';
	if (player === 'external')
		return account
			? `, or use DMM Watch with ${yours(accounts)}, which needs no host`
			: usenet
				? ", or switch to Real-Debrid and use DMM's transfer with DMM Watch, which needs no host"
				: '';
	if (player === 'webdav') {
		const webdav = providerWebdav(selected);
		if (webdav.length)
			return `, or use ${orList(webdav.map((source) => SOURCE_LABELS.get(source)!))} WebDAV, which needs no host`;
		if (!usenet) return '';
		// An undecided player started on WebDAV for own Usenet can still pick Stremio.
		return undecided
			? ", or switch to TorBox hosted NZBs through TorBox Cast in Stremio, or to DMM's Real-Debrid transfer, which need no host"
			: ", or switch to Real-Debrid and use DMM's transfer with Real-Debrid WebDAV, which needs no host";
	}
	// Plex Media Server, Jellyfin, Emby and rex always need a host.
	return '';
}
function route(
	id: string,
	title: string,
	summary: string,
	host: HostRequirement,
	components: string[],
	requirements: string[] = [],
	links: SetupLink[] = [],
	limits: string[] = []
): SourceRoute {
	return {
		id,
		title,
		summary,
		host,
		components,
		requirements,
		links,
		limits,
		status: 'integrated',
	};
}
function zurgRoute(
	source: SetupSource,
	player: Player,
	plexRoute: PlexRoute | undefined
): SourceRoute {
	const direct = source === 'usenet';
	const hosted = source === 'torbox-hosted';
	const input = direct
		? 'Your NNTP account'
		: hosted
			? 'TorBox Pro hosted NZBs'
			: SOURCE_LABELS.get(source)!;
	const server = player === 'plex' || player === 'jellyfin' || player === 'emby';
	const rex = player === 'plex' && (plexRoute === 'rex' || plexRoute === 'either');
	const output = rex
		? 'rex → Plex apps'
		: player === 'plex'
			? 'filesystem mount → your existing Plex Media Server → Plex apps'
			: player === 'jellyfin'
				? 'filesystem mount → Jellyfin'
				: player === 'emby'
					? 'filesystem mount → Emby'
					: player === 'stremio'
						? 'Stremio NZB search addon → Stremio'
						: player === 'kodi'
							? 'WebDAV → Kodi'
							: player === 'webdav'
								? 'WebDAV → your WebDAV or SMB player'
								: 'playable file → your external player';
	const id = rex
		? 'zurg-rex-plex'
		: player === 'plex'
			? 'zurg-mounted-plex'
			: `${player}-zurg-${direct ? 'direct-usenet' : hosted ? 'hosted-nzb' : 'debrid'}`;
	const r = route(
		id,
		`${input} → zurg → ${rex ? 'rex → Plex apps' : player === 'external' ? 'your external player' : player === 'webdav' ? 'your WebDAV or SMB player' : player === 'plex' ? 'your Plex Media Server' : PLAYER_OPTIONS.find((x) => x.value === player)?.label}`,
		'zurg supplies files to your chosen player or media server. Keep the source account and serving host available while you watch.',
		server ? 'server' : 'zurg',
		[
			`${input} → zurg ${direct ? 'direct Usenet backend' : hosted ? 'hosted NZB backend' : 'debrid library'} → ${output}`,
		],
		[
			'Current zurg nightlies require an active sponsorship.',
			...(direct
				? [
						// Stremio's search addon takes NZBs from the indexer its own sentence below names.
						player === 'stremio'
							? 'Your NNTP credentials.'
							: 'NZB files and your NNTP credentials; an indexer is needed if you want search.',
					]
				: hosted
					? ['TorBox Pro and NZB files to submit.']
					: ['Configure your provider account in zurg.']),
		],
		[
			ZURG,
			...(hosted ? [TORBOX_NZB] : []),
			...(rex ? [REX] : player === 'stremio' ? [STREMIO] : []),
		],
		[
			'zurg serves bytes, not transcoded video; the player or media server handles codec compatibility.',
			...(direct
				? [
						'Direct Usenet reads articles as needed and is distinct from TorBox hosted NZBs.',
					]
				: []),
		]
	);
	r.usesZurg = true;
	if (rex) r.usesRex = true;
	if (direct || hosted) r.zurgNzb = direct ? 'direct' : 'hosted';
	if (player === 'stremio')
		r.requirements.push(
			'The Stremio NZB search addon needs a configured Newznab indexer; another device needs a reachable HTTPS addon address.'
		);
	return r;
}
function sourceRoute(source: SetupSource, answers: SetupAnswers, player: Player): SourceRoute {
	const debrid = DEBRID_SOURCES.includes(source);
	const cast = DMM_CAST_LINKS[source];
	const rex =
		player === 'plex' && (answers.plexRoute === 'rex' || answers.plexRoute === 'either');
	if (source === 'http-local') {
		if (rex)
			return Object.assign(
				route(
					'rex-http-plex',
					'HTTP source + rex feed → Plex apps',
					'Submit media identity and metadata through the rex feed API. The feed producer and HTTP server serving bytes can be separate; no zurg or debrid account is required.',
					'server',
					['Your HTTP source + rex feed → rex → Plex apps'],
					[
						'A feed producer that submits media identity and metadata, plus a host for rex. Local files must be served over HTTP.',
					],
					[HTTP],
					[
						'rex does not scan disks or identify files from names; a bare URL does not supply its metadata.',
					]
				),
				{ usesRex: true }
			);
		if (player === 'stremio') {
			const r = route(
				'http-source-needs-player',
				'Connect your files through a compatible addon',
				'A bare HTTP URL or disk is not automatically a Stremio library.',
				'none',
				[],
				[
					'Use a compatible Stremio addon for this source, or open the file in a compatible local/network player.',
				],
				[GUIDE]
			);
			r.status = 'separate';
			return r;
		}
		const server = player === 'plex' || player === 'jellyfin' || player === 'emby';
		const name =
			player === 'plex'
				? 'your existing Plex Media Server'
				: player === 'jellyfin'
					? 'Jellyfin'
					: player === 'emby'
						? 'Emby'
						: player === 'kodi'
							? 'Kodi'
							: player === 'webdav'
								? 'your WebDAV or SMB player'
								: 'your external player';
		return route(
			`${player}-existing-library`,
			`Keep ${name} for local or HTTP files`,
			'Use your existing files without adding debrid or zurg. Local files and network media still need a path or protocol your player supports.',
			server ? 'server' : 'none',
			[`Local files or a compatible HTTP/network source → ${name}`],
			[
				server
					? 'Keep the media server running with access to the files. Use a supported library adapter for HTTP URLs; a URL is not a filesystem path.'
					: 'Open a local file, supported HTTP URL or existing network share. A NAS/file server must remain available for remote files.',
			],
			[GUIDE],
			server && player === 'plex'
				? [
						'Plex Media Server normally uses library paths, not .strm files; use local/mounted files or a compatible source integration.',
					]
				: []
		);
	}
	if (source === 'url-addon') {
		if (rex)
			return Object.assign(
				route(
					'rex-stremio-plex',
					'Stremio URL addons → rex → Plex apps',
					'Use rex-stremio to bring compatible addon catalogs and streams into Plex apps.',
					'server',
					['Stremio catalogs + URL stream addons → rex-stremio → rex → Plex apps'],
					['Run rex and rex-stremio; supply catalog and compatible stream addons.'],
					[ADDON],
					[
						'rex-stremio needs playable URLs; raw torrent streams are incompatible. HLS needs the documented FFmpeg setup.',
					]
				),
				{ usesRex: true }
			);
		if (player === 'stremio')
			return route(
				'existing-url-addon-stremio',
				'Keep your existing Stremio URL addons',
				'Your addon already supplies streams to the app you chose.',
				'none',
				['Existing Stremio addons → Stremio'],
				['Keep the addon and any required provider account configured.'],
				[],
				['Availability and supported formats depend on the addon and device.']
			);
		const r = route(
			'separate-url-addon',
			'Keep the addon in its supported player',
			'Stremio URL addons are not automatically sources for the selected player.',
			'none',
			[],
			['Use Stremio directly, or rex-stremio with a normal host for Plex apps.'],
			[ADDON]
		);
		r.status = 'separate';
		return r;
	}
	if (source === 'easynews' && !['stremio', 'kodi', 'external'].includes(player)) {
		const zurgNzb = answers.sources.some(
			(other) => other === 'usenet' || other === 'torbox-hosted'
		);
		const r = route(
			'separate-easynews',
			'Use Easynews through Cast, Kodi or Watch',
			'The Easynews web account is a separate HTTP route; it does not configure a news server or media-server plugin.',
			'none',
			[],
			[
				// A release sent to zurg is an NZB, so only zurg's NZB account (own Usenet, or TorBox
				// hosted off Android) fetches it for rex.
				`Keep Easynews in a compatible player.${rex && answers.host === 'android' ? ` For rex on Android${answers.sources.includes('usenet') ? ', only releases you send to zurg reach it' : ' there is no feed for it'}; a normal host can take a compatible URL addon or feed producer.` : rex ? (zurgNzb ? " For rex, releases you send to zurg reach it through zurg's NZB account; a compatible URL addon or feed producer can supply the rest." : ' For rex, a compatible URL addon or feed producer must supply streams and metadata.') : ''}`,
			],
			[
				DMM_CAST_LINKS.easynews,
				{ label: 'Kodi setup', href: '/kodi' },
				{ label: 'DMM player settings', href: '/settings' },
			]
		);
		r.status = 'separate';
		return r;
	}
	if (player === 'stremio' && (debrid || source === 'easynews' || source === 'torbox-hosted')) {
		const hosted = source === 'torbox-hosted';
		const label = SOURCE_LABELS.get(source)!;
		return Object.assign(
			route(
				hosted ? 'torbox-hosted-stremio' : 'dmm-cast-stremio',
				hosted ? 'TorBox hosted NZBs → TorBox Cast → Stremio' : 'DMM Cast → Stremio',
				hosted
					? 'Submit NZBs through DMM to TorBox Pro, wait for completion, then use TorBox Cast.'
					: 'Use your account in Stremio without running zurg, rex or a media server.',
				'none',
				[
					'DMM Cast addon → your player',
					source === 'easynews'
						? 'Stremio searches Easynews and plays its files.'
						: 'Stremio plays the selected provider library.',
				],
				hosted
					? [
							"TorBox Pro. Submit NZBs from DMM's Usenet tab; finished downloads appear in TorBox Cast.",
						]
					: [`${/^[AEIOU]/.test(label) ? 'An' : 'A'} ${label} account.`],
				[hosted ? { label: 'TorBox Cast setup', href: '/stremio-torbox' } : cast],
				[
					'The provider must supply a playable file; a catalog entry is not a guarantee of availability.',
				]
			),
			{ usesCast: true }
		);
	}
	// The Kodi addon reads Cast's stream endpoint, so the Cast profile's limits apply.
	if (player === 'kodi' && (debrid || source === 'easynews' || source === 'torbox-hosted'))
		return Object.assign(
			route(
				'dmm-kodi',
				'DMM Kodi addon → your account',
				'Browse, search and play in Kodi with the account you already have.',
				'none',
				['DMM Kodi addon → Kodi'],
				[
					source === 'torbox-hosted'
						? "TorBox Pro, paired with the Kodi addon. Submit NZBs from DMM's Usenet tab; finished downloads appear in the addon's TorBox library."
						: 'Pair your provider or Easynews account with the Kodi addon.',
				],
				[{ label: 'Kodi setup', href: '/kodi' }]
			),
			{ usesCast: true }
		);
	if (player === 'external' && (debrid || source === 'easynews'))
		return route(
			'external-player',
			'DMM Watch → your external player',
			'Choose a file in DMM and open it in your supported player.',
			'none',
			['DMM Watch → external player'],
			['Choose a supported player in DMM settings.'],
			[{ label: 'DMM settings and player choice', href: '/settings' }]
		);
	if (player === 'jellyfin' && source === 'usenet' && answers.preference !== 'arr')
		return route(
			'jellyfin-nzb-plugin',
			'Jellyfin NZB plugin → your NNTP account',
			'Stream NZBs inside Jellyfin without a separate zurg service.',
			'server',
			['Jellyfin server + the standalone Jellyfin NZB plugin'],
			[
				'NZB files, NNTP credentials, a supported Jellyfin version and active DMM sponsorship for plugin distribution.',
			],
			[JELLYFIN],
			[
				'Compressed or encrypted archive members are excluded and the plugin does not repair with PAR2.',
			]
		);
	if (['jellyfin', 'emby'].includes(player) && debrid && answers.preference !== 'arr') {
		const name = player === 'jellyfin' ? 'Jellyfin' : 'Emby';
		return route(
			`${player}-provider-plugins`,
			`Provider plugin inside ${name}`,
			'Use the provider integration inside your existing media server, without a separate zurg application or mount.',
			'server',
			[`${name} + matching DMM provider plugin(s)`],
			[
				'A supported server version, provider credentials and active DMM sponsorship for plugin distribution.',
			],
			[{ label: `DMM ${name} plugin setup`, href: `/${player}` }],
			[
				`Plugins have their own archive/version limits.${player === 'emby' ? ' DMM Emby plugins cover debrid, not direct NNTP or hosted NZBs.' : ''}`,
			]
		);
	}
	const webdav = providerWebdav(answers.sources).includes(source) && PROVIDER_WEBDAV[source];
	if (player === 'webdav' && webdav && answers.host === 'none' && answers.preference !== 'arr') {
		const name = SOURCE_LABELS.get(source)!;
		return route(
			'provider-webdav',
			`${name} WebDAV → your WebDAV or SMB player`,
			`Add ${name}'s own WebDAV server to your player. No host or zurg is needed.`,
			'none',
			[`${name} WebDAV → your WebDAV or SMB player`],
			[
				`Add ${webdav} to your player and sign in with the WebDAV credentials ${name} documents for your account.`,
			],
			[],
			[`zurg is not involved, so ${name}'s own folder layout applies.`]
		);
	}
	return zurgRoute(source, player, answers.plexRoute);
}
export function recommendSetup(answers: SetupAnswers): SetupRecommendation {
	// In SOURCE_OPTIONS order, so the order sources were picked in changes no route, link or sentence.
	const selected = SOURCE_OPTIONS.map(({ value }) => value).filter(
		(source) => source !== 'none' && answers.sources.includes(source)
	);
	const player = resolvePlayer({ player: answers.player, sources: selected });
	const rex =
		player === 'plex' && (answers.plexRoute === 'rex' || answers.plexRoute === 'either');
	// Under Sonarr/Radarr zurg is the download client, so a route without zurg does not fit.
	const rexWithoutZurg =
		rex &&
		answers.preference !== 'arr' &&
		selected.some((source) => DEBRID_SOURCES.includes(source)) &&
		!selected.includes('url-addon');
	// rex-stremio is on the URL addon route, in the alternative without zurg, or, with no source, in the
	// summary for a normal host; the Android summary leaves it to a normal host.
	const rexStremio =
		rexWithoutZurg ||
		(rex &&
			(selected.includes('url-addon') || (!selected.length && answers.host !== 'android')));
	const chosenPlayer =
		player === 'webdav'
			? 'a WebDAV or SMB player'
			: player === 'external'
				? 'an external player'
				: PLAYER_PHRASES[player];
	const routes = selected.map((source) => ({
		source,
		route: sourceRoute(source, answers, player),
	}));
	const integrated = routes.filter((x) => x.route.status === 'integrated');
	const first = (integrated[0] ?? routes[0])?.route;
	// TorBox Pro hosted NZBs belong to the TorBox account, so the pair is one source.
	const accounts =
		selected.length -
		(selected.includes('torbox') && selected.includes('torbox-hosted') ? 1 : 0);
	const result: SetupRecommendation = {
		primaryRoute: first
			? { id: first.id, title: first.title, summary: first.summary }
			: {
					id: 'choose-source-first',
					title: `Choose a source for ${PLAYER_PHRASES[player]}`,
					summary: `${rex ? (answers.host === 'android' ? REX_ANDROID_ACCOUNTS : REX_ACCOUNTS) : ACCOUNTS_FOR_PLAYER[player]} DMM does not supply video bytes by itself.`,
				},
		whyMatched: [
			answers.player === 'unsure'
				? `You have not chosen a player; ${chosenPlayer} is a starting option${accounts > 1 ? ' for these sources' : accounts ? ' for this source' : ''}.`
				: `You chose ${chosenPlayer}.`,
			`You selected “${PREFERENCE_OPTIONS.find((x) => x.value === answers.preference)?.label}.”`,
		],
		components: routes.flatMap((x) => x.route.components),
		prerequisites: routes.flatMap((x) => x.route.requirements),
		limits: routes.flatMap((x) => x.route.limits),
		setupLinks: routes.flatMap((x) => x.route.links),
		alternatives: [],
		optionalNeeds: [],
		conflicts: [],
		sourceNotes: [],
		hostRequirement: 'none',
		sponsorship: {
			required: [],
			optional: [],
			freeFeatures: [],
			routeAvailable: false,
			usesDmmTools: false,
			hasAccount: false,
		},
		sourceCoverage: routes.map(({ source, route: r }) => ({
			source,
			label: SOURCE_LABELS.get(source)!,
			status: r.status,
			integration: r.status === 'integrated' ? r.title : r.summary,
			requirements: r.requirements,
			setupLinks: r.links,
		})),
	};
	const links = (...items: SetupLink[]) => result.setupLinks.push(...items);
	const host = (required: HostRequirement) => {
		if (required === 'server' || (required === 'zurg' && result.hostRequirement === 'none'))
			result.hostRequirement = required;
	};
	routes.forEach((x) => host(x.route.host));
	if (accounts > 1)
		result.sourceNotes.push(
			'Multiple sources can coexist, but each keeps its own credentials, quota and availability. The source list below shows the route for each.'
		);
	// In Stremio, TorBox's DMM Cast and TorBox Cast for its hosted NZBs are one addon, /stremio-torbox.
	const torboxAddon = player === 'stremio' && selected.includes('torbox-hosted');
	const titles = integrated
		.filter(({ source }) => !torboxAddon || source !== 'torbox')
		.map((x) => x.route.title);
	if (new Set(titles).size > 1)
		result.primaryRoute = {
			id: 'combined-sources',
			title: `Combine your sources in ${PLAYER_PHRASES[player]}`,
			summary:
				'Use the routes below together. Each source retains its own requirements; adding one integration does not configure the others.',
		};
	if (!selected.length)
		result.prerequisites.push(
			'Choose a provider account, your own news account, an addon or files you already have.'
		);
	if (selected.includes('torbox-hosted')) {
		result.sourceNotes.push(
			'TorBox hosted NZBs require TorBox Pro; a normal TorBox torrent subscription alone does not provide hosted Usenet.'
		);
		result.limits.push(
			'TorBox must finish and repair a hosted NZB before playback. Active downloads share account slots and retained files can expire.'
		);
	}
	if (selected.includes('easynews'))
		result.sourceNotes.push(
			'Easynews is a web account for HTTP files. NNTP credentials, if you have them, are a separate source configuration; an Easynews web login does not configure zurg.'
		);
	const debridAccounts =
		selected.filter((source) => DEBRID_SOURCES.includes(source)).length > 1
			? 'debrid accounts'
			: 'debrid account';
	const backendKinds = new Set(routes.map((x) => x.route.zurgNzb).filter(Boolean));
	if (backendKinds.size === 2) {
		result.prerequisites.push(
			`Direct NNTP and TorBox hosted NZBs need separate zurg instances and separate data directories; one instance cannot enable both backends.${TWO_ZURGS_WANTED}`
		);
		links(TWO_ZURGS);
	}
	if (rex) {
		result.limits.push(
			`rex is an independent server for Plex apps, not Plex Media Server. Check its tested-client compatibility. ${answers.host === 'android' ? 'On Android, rex comes inside the sponsor-only zurg+rex app.' : `${rexStremio ? 'rex and rex-stremio do not' : 'rex does not'} require sponsorship.`}`
		);
		links(note('rex/faq', 'rex compatibility and limits'));
		if (rexWithoutZurg)
			result.alternatives.push({
				title: 'Without zurg: rex-stremio with a debrid stream addon',
				detail: `Run rex and rex-stremio${answers.host === 'android' ? ' on a normal host' : ''} with a Stremio stream addon that returns links through your ${debridAccounts}; no zurg and no sponsorship needed.`,
				links: [ADDON],
			});
		if (selected.includes('http-local'))
			result.sourceNotes.push(
				'An HTTP file or local disk needs a feed producer for rex; the program submitting metadata can be separate from the HTTP byte server.'
			);
	}
	if (player === 'webdav') {
		result.alternatives.push({
			title: 'For an SMB-only player',
			detail: 'Use an existing SMB share, or zurg → filesystem mount → host SMB share → player. The host provides SMB; zurg itself does not. This bridge needs a normal host, not just the zurg+rex Android app.',
			links: [ZURG],
		});
		const skipZurg = providerWebdav(selected);
		for (const source of selected) {
			const name = SOURCE_LABELS.get(source)!;
			const webdav = skipZurg.includes(source) && PROVIDER_WEBDAV[source];
			if (source === 'offcloud')
				result.sourceNotes.push(
					`${name} has no WebDAV of its own, so a WebDAV player needs zurg on a host.`
				);
			else if (webdav && answers.host !== 'none' && answers.preference !== 'arr')
				result.alternatives.push({
					title: `Skip zurg: ${name} WebDAV`,
					detail: `Add ${webdav} to your player and sign in with the WebDAV credentials ${name} documents for your account. zurg is not involved, so ${name}'s own folder layout applies.`,
					links: [],
				});
		}
	}
	// Beside the Kodi addon, Kodi's own WebDAV source reads a provider WebDAV or zurg.
	const kodiWebdav = providerWebdav(selected);
	// A zurg route for Kodi already ends in WebDAV → Kodi.
	const kodiReadsZurg = player === 'kodi' && routes.some(({ route: r }) => r.usesZurg);
	// Sonarr/Radarr import into zurg's __magic__ folders, which only zurg's own WebDAV shows.
	const arrZurgWebdav =
		player === 'kodi' &&
		answers.preference === 'arr' &&
		!kodiReadsZurg &&
		selected.some((source) => DEBRID_SOURCES.includes(source));
	if (arrZurgWebdav)
		result.alternatives.push({
			title: "Browse the Sonarr/Radarr library over zurg's WebDAV",
			detail: "Sonarr/Radarr imports land in zurg's __magic__ folders, which the Kodi addon does not show; add zurg's WebDAV as a Kodi source to browse them.",
			links: [ZURG],
		});
	else if (player === 'kodi' && answers.preference !== 'arr' && kodiWebdav.length) {
		const severalWebdav = kodiWebdav.length > 1;
		result.alternatives.push({
			title: 'Browse over WebDAV instead',
			// Own Usenet is the only source Kodi plays through zurg; the addon plays TorBox hosted NZBs.
			// With no host that zurg is not running yet, so there is none to join.
			detail: `Kodi also reads WebDAV: add ${orList(kodiWebdav.map((source) => `${SOURCE_LABELS.get(source)} WebDAV (${PROVIDER_WEBDAV[source]})`))} with no host and sign in with the WebDAV credentials ${orList(kodiWebdav.map((source) => SOURCE_LABELS.get(source)!))} documents for your account${severalWebdav ? 's' : ''}, or ${kodiReadsZurg && answers.host !== 'none' ? `add your ${debridAccounts} to the zurg your Usenet account runs on and browse it over its WebDAV` : 'run zurg → WebDAV → Kodi on a host for exact naming and placement'}.`,
			links: [ZURG],
		});
	}
	if (answers.player === 'plex' && answers.plexRoute === 'either')
		result.alternatives.push({
			title: 'Use Plex Media Server instead',
			detail: `Keep or install Plex Media Server for local files and mounted zurg libraries. rex is optional; an existing Plex server can remain alongside it.${answers.host === 'android' ? ' Plex Media Server itself still needs a normal host; zurg+rex Android does not run it.' : ''}`,
			links: [ZURG, note('rex/from-plex', 'Choosing between Plex Media Server and rex')],
		});
	// A provider or NZB plugin serves only that server; a mount serves every consumer on the host.
	const plugins = selected.filter(
		(source) =>
			DEBRID_SOURCES.includes(source) || (player === 'jellyfin' && source === 'usenet')
	).length;
	if ((player === 'jellyfin' || player === 'emby') && answers.preference !== 'arr' && plugins) {
		// Another source already runs zurg; a debrid account joins it, an nzb account cannot.
		// With no host that zurg is not running yet, so there is none to join.
		const join =
			answers.host !== 'none' &&
			routes.some(({ route: r }) => r.usesZurg) &&
			selected.some((source) => DEBRID_SOURCES.includes(source));
		// TorBox hosted NZBs hold that zurg's one NZB account, so the plugin's own Usenet needs another.
		const second =
			player === 'jellyfin' &&
			selected.includes('usenet') &&
			selected.includes('torbox-hosted');
		const consumers = 'when Kodi, a WebDAV player or another server must read the same library';
		result.alternatives.push({
			title: `zurg → mount → ${playerLabel(player)} when other consumers need the files`,
			detail: second
				? `${join ? `Add your ${debridAccounts} to that zurg's mount and run` : 'Run'} a second zurg with an nzb account and its own mount and data directory ${consumers}; one zurg takes only one NZB account.${TWO_ZURGS_WANTED}`
				: `${join ? `Add your ${debridAccounts} to ${backendKinds.size === 2 ? "one of those zurgs' mounts" : "that zurg's mount"}` : 'Run zurg with a filesystem mount'} instead of the plugin${plugins > 1 ? 's' : ''} ${consumers}.`,
			links: second ? [ZURG, TWO_ZURGS] : [ZURG],
		});
	}
	if (answers.preference === 'arr') {
		host('server');
		result.primaryRoute = {
			id: 'arr-zurg',
			title: 'DMM indexers → Sonarr/Radarr → zurg',
			summary:
				'Automate acquisition with arr, then keep the playback routes below for your selected player.',
		};
		const debrid = selected.some((s) => DEBRID_SOURCES.includes(s));
		const nzb = selected.includes('usenet') || selected.includes('torbox-hosted');
		const torrents = 'qBittorrent-compatible torrent interface';
		const nzbs = 'SABnzbd-compatible NZB interface';
		result.components.unshift(
			`Sonarr or Radarr → zurg ${debrid === nzb ? `${torrents} or ${nzbs}` : debrid ? torrents : nzbs}`
		);
		result.prerequisites.push(
			'A normal host for arr and zurg; current zurg and DMM Torznab/Newznab require active sponsorship.'
		);
		if (!debrid && !nzb)
			result.conflicts.push(
				preferenceChoiceReason(answers, 'arr') ??
					'Arr acquisition needs a supported debrid or NZB backend. Easynews web access, URL addons and existing files are not download-client backends.'
			);
		// The playback route may not run zurg, so say what the download client needs.
		if (debrid || nzb) links(ZURG);
		for (const source of selected)
			if (DEBRID_SOURCES.includes(source))
				result.prerequisites.push(
					`Configure your ${SOURCE_LABELS.get(source)} account in zurg; Sonarr/Radarr hand torrents to it.`
				);
		if (selected.includes('usenet'))
			result.prerequisites.push(
				'Give zurg an nzb account with your NNTP credentials; Sonarr/Radarr hand NZBs to it.'
			);
		if (selected.includes('torbox-hosted')) {
			result.prerequisites.push(
				'Give zurg a torbox_nzb account (TorBox Pro); Sonarr/Radarr hand NZBs to it.'
			);
			links(TORBOX_NZB);
		}
		if (debrid)
			links(
				{ label: 'DMM Torznab setup', href: '/torznab' },
				note('zurg/guides/sonarr-radarr-torrents', 'Sonarr/Radarr torrent setup')
			);
		if (nzb) links(NEWZNAB);
		if (nzb) links(note('zurg/guides/sonarr-radarr', 'Sonarr/Radarr NZB setup'));
		links(note('zurg/guides/acquisition', 'Acquisition options'));
		if (player === 'stremio' && selected.includes('usenet'))
			result.limits.push(
				'The zurg Stremio addon searches NZBs at playback time; it is not a general arr library catalog. Cast can expose supported provider libraries, while WebDAV or a media server suits browsing an arr-managed library.'
			);
		if (
			selected.includes('usenet') &&
			selected.includes('torbox-hosted') &&
			backendKinds.size !== 2
		) {
			result.prerequisites.push(
				`For arr acquisition, direct NNTP and hosted TorBox NZBs require separate zurg instances and data directories.${TWO_ZURGS_WANTED}`
			);
			links(TWO_ZURGS);
		}
	}
	if (selected.includes('real-debrid')) {
		const arr = answers.preference === 'arr';
		// Without an NZB account zurg is no NZB download client, so the indexer belongs to this route.
		const indexer = arr && !selected.includes('usenet') && !selected.includes('torbox-hosted');
		result.alternatives.push({
			title: 'NZBs without your own news account',
			detail: `DMM can transfer a Usenet result into your Real-Debrid library, subject to its transfer allowance and queue. This is a hosted transfer, not native NNTP in Real-Debrid.${arr ? " Sonarr and Radarr can hand NZBs to DMM's SABnzbd-compatible endpoint, which transfers them into your Real-Debrid account. Sends get sponsor priority and allowance only with your DMM API key in that SABnzbd client's Password field. Sonarr/Radarr still need a Usenet indexer such as DMM's Newznab." : ''}`,
			links: [
				{ label: 'DMM Transfers', href: '/transfers' },
				...(arr ? [{ label: 'DMM SABnzbd endpoint', href: '/sabnzbd' }] : []),
				...(indexer ? [NEWZNAB] : []),
				{
					label: 'Usenet route comparison',
					href: SETUP_GUIDE_URL + '#usenet-without-a-usenet-account-which-route',
				},
			],
		});
	}
	// The same zurg the Wanted benefit waits for: on the route, Sonarr/Radarr's host or one that can run it.
	if (
		(answers.preference === 'managed' || answers.preference === 'arr') &&
		selected.some(
			(source) =>
				DEBRID_SOURCES.includes(source) || source === 'usenet' || source === 'torbox-hosted'
		) &&
		(answers.preference === 'arr' ||
			routes.some(({ route: r }) => r.usesZurg) ||
			hostRunsZurg(answers))
	) {
		const seerr = seerrFits(player, answers.plexRoute, answers.host);
		// Stremio and Kodi browse a hosted Cast library; an external player browses DMM's library
		// pages. Own Usenet and zurg's hosted NZBs have neither.
		const browsable =
			routes.some(({ route: r }) => r.usesCast) ||
			selected.some((source) => DEBRID_SOURCES.includes(source));
		if (nzbPluginOnly(player, selected, routes))
			result.alternatives.push({
				title: 'Wanted and Seerr need the zurg mount route',
				detail: 'zurg fetches Wanted and Seerr requests into its own library, which the NZB plugin does not read; use zurg → mount → Jellyfin for them.',
				links: [ZURG],
			});
		else
			result.alternatives.push({
				title: seerr ? 'DMM Wanted or Seerr requests' : 'DMM Wanted requests',
				detail: `Use Wanted → zurg for automatic acquisition without arr.${seerr ? ' Seerr can send requests through DMM Wanted.' : ''} These need sponsorship and a running zurg host${browsable && (player === 'stremio' || player === 'kodi') ? '; hosted Cast libraries do not need your own server just to browse them.' : browsable && player === 'external' ? "; DMM's library pages do not need your own server just to browse them." : '.'}`,
				links: [
					note('zurg/guides/dmm-wanted', 'DMM Wanted setup'),
					...(seerr ? [note('dmm/seerr', 'Seerr through DMM')] : []),
				],
			});
	}
	const androidRex = androidRunsRex(answers);
	// Direct Usenet needs 64-bit Android; zurg and rex run on 32-bit too.
	const android64 = routes.some(({ route: r }) => r.zurgNzb === 'direct') ? '64-bit ' : '';
	if (
		result.hostRequirement === 'server' &&
		(answers.host === 'none' || (answers.host === 'android' && !androidRex))
	)
		result.conflicts.push(
			answers.preference === 'arr'
				? (preferenceChoiceReason(answers, 'arr') ??
						'The arr workflow needs an existing or willing full host for Sonarr/Radarr and zurg.')
				: answers.host === 'android'
					? (hostChoiceReason(answers, answers.host) ??
						`This route needs a normal host for ${rex ? 'rex' : playerLabel(player)}. zurg+rex Android runs zurg and the rex zurg feeds, not that whole server stack.`)
					: `${rex ? 'rex and its source need' : `${player === 'plex' ? 'Plex Media Server' : playerLabel(player)} needs`} a machine that stays on. Choose a host${androidRunsRex({ ...answers, host: 'android' }) ? ` or a supported ${android64}Android device` : ''}.`
		);
	const hostedNzb = routes.some(({ route: r }) => r.zurgNzb === 'hosted');
	if (answers.host === 'android' && hostedNzb) result.conflicts.push(ANDROID_HOSTED_NZB);
	if (result.hostRequirement === 'zurg' && answers.host === 'none')
		result.conflicts.push(
			`zurg needs a host that stays on while you watch. Choose a host${hostedNzb ? '' : ` or a supported ${android64}Android device`}${noHostClause(player, selected, answers.player === 'unsure')}.`
		);
	const androidZurg =
		answers.host === 'android' && (result.hostRequirement === 'zurg' || androidRex);
	if (androidZurg) {
		const app =
			'zurg+rex Android needs sponsor access, a supported device and background operation;';
		const noHostedNzb = 'has no TorBox hosted NZB (torbox_nzb) backend.';
		result.prerequisites.push(
			androidRex
				? `${app} it runs zurg and rex on the device, so the Plex apps play from it. ${android64 ? 'Direct Usenet requires 64-bit Android; it' : 'It'} ${noHostedNzb}`
				: `${app} ${android64 ? 'direct Usenet requires 64-bit Android, and zurg+rex Android' : 'it'} ${noHostedNzb}`
		);
	}
	// The app stands in for the desktop zurg and rex guides, so its own guide leads; with no
	// source chosen yet it is still where rex on Android starts.
	if (androidZurg || (answers.host === 'android' && rex && !selected.length))
		result.setupLinks = [
			note('zurg/guides/android', 'zurg+rex Android guide'),
			...result.setupLinks.filter((link) => link !== ZURG && link !== REX),
		];
	if (answers.needs.includes('remote')) {
		const selfHosted =
			'Self-hosted playback needs a securely reachable address; a LAN address works only at home.';
		result.optionalNeeds.push(
			// A media server or rex is always self-hosted; the arr download client's host does not serve playback.
			androidRex
				? 'zurg+rex runs on the Android device itself; the Plex apps on it play anywhere, while other devices reach it over your home network. A NAS or file server at home needs a secure reachable connection too.'
				: playerNeedsFullHost(player)
					? selfHosted
					: !routes.some(({ route: r }) => r.host !== 'none')
						? 'Hosted Cast/direct playback avoids exposing a home server; any NAS or file server still needs a secure reachable connection for remote use.'
						: answers.host === 'android' &&
							  !routes.some(({ route: r }) => r.host === 'server')
							? `zurg runs on the Android device itself: a phone or tablet takes it with you, while a TV box at home needs a secure reachable connection like any home server.${selected.includes('http-local') ? ' A NAS or file server at home needs one too.' : ''}`
							: selfHosted
		);
	}
	const provider = selected.some(
		(source) =>
			DEBRID_SOURCES.includes(source) ||
			source === 'easynews' ||
			source === 'usenet' ||
			source === 'torbox-hosted'
	);
	if (provider && (answers.needs.includes('family') || answers.needs.includes('remote')))
		result.optionalNeeds.push(
			`Check provider IP and concurrency rules.${selected.includes('real-debrid') ? ' Real-Debrid use must stay on one public IP; direct playback from different homes can violate that even with a central catalog.' : ''}`
		);
	if (answers.needs.includes('offline'))
		result.optionalNeeds.push(
			'Download or copy complete files and verify playback without the network. Virtual files, .strm links and debrid catalogs are not offline copies.'
		);
	if (answers.needs.includes('subtitles')) {
		// Bazarr works off Sonarr/Radarr imports; its sidecars sit in zurg's folders, read only by
		// zurg or rex playback. zurg's Stremio addon hands out /strm/e/ links and serves no subtitles.
		const arr = answers.preference === 'arr';
		const bazarr =
			arr && (rex || (player !== 'stremio' && routes.some(({ route: r }) => r.usesZurg)));
		// Sorted, so the order sources were picked in does not change the sentence.
		const unreached = [
			...new Set(
				routes.flatMap(({ route: r }) =>
					r.id === 'dmm-kodi'
						? ['the Kodi addon']
						: r.usesCast
							? ['DMM Cast']
							: r.id === 'external-player'
								? ['DMM Watch']
								: player === 'stremio' && r.usesZurg
									? ["zurg's Stremio addon"]
									: []
				)
			),
		].sort();
		// Kodi still reads zurg's files, sidecars included, over a zurg WebDAV source.
		const unreachedRoutes = unreached.length
			? `${orList(unreached)}${kodiReadsZurg || arrZurgWebdav ? '; they do reach Kodi as a zurg WebDAV source' : ''}`
			: '';
		result.optionalNeeds.push(
			rex
				? bazarr
					? 'rex offers Search Subtitles without Bazarr; with Sonarr/Radarr, Bazarr sidecar subtitles reach rex too.'
					: 'rex offers Search Subtitles without Bazarr. Embedded/player subtitles may already be sufficient.'
				: bazarr
					? `Check embedded or player subtitle support. For arr and zurg, Bazarr can store local sidecar subtitles.${unreachedRoutes ? ` They do not reach ${unreachedRoutes}.` : ''}`
					: arr && unreachedRoutes
						? `Bazarr sidecars live beside zurg's files and do not reach ${unreachedRoutes}; check embedded or player subtitle support.`
						: 'Check embedded or player subtitle support.'
		);
		if (bazarr) links(note('zurg/guides/subtitles', 'Subtitle setup notes'));
	}
	if (answers.needs.includes('mixed')) {
		// Local files and an addon the player cannot use bring no cloud titles; two accounts in
		// one route (the Kodi addon, say) are still one route, as is Stremio's one TorBox addon.
		const cloudRoutes = new Set(
			integrated
				.filter(
					({ source }) => source !== 'http-local' && (!torboxAddon || source !== 'torbox')
				)
				.map(({ route: r }) => r.title)
		).size;
		// Under a conflict the routes above are not a setup yet.
		const cloud = `cloud titles come from ${result.conflicts.length ? 'the route you choose' : cloudRoutes > 1 ? 'the routes above' : cloudRoutes ? 'the route above' : 'the route you choose'}.`;
		result.optionalNeeds.push(
			rex && answers.host === 'android'
				? 'zurg+rex Android feeds rex from zurg only; local files need rex on a normal host, or a player on the device.'
				: rex
					? 'Local files join rex through an HTTP source and a feed producer; each source supplies its own metadata and reachable HTTP bytes.'
					: playerNeedsFullHost(player)
						? 'Keep local files in your existing media server alongside cloud integrations.'
						: player === 'stremio'
							? `Stremio needs a compatible addon for local files; ${cloud}`
							: `Local files stay in your player; ${cloud}`
		);
	}
	links(GUIDE);
	result.setupLinks = result.setupLinks.filter(
		(l, i, all) => all.findIndex((x) => x.href === l.href) === i
	);
	for (const key of [
		'components',
		'prerequisites',
		'limits',
		'conflicts',
		'sourceNotes',
	] as const)
		result[key] = [...new Set(result[key])];
	if (result.conflicts.length) {
		result.primaryRoute = {
			id: 'resolve-constraints',
			title: 'Resolve the setup requirements first',
			summary:
				'Change the highlighted answers before using a starting route. Sponsorship does not remove host, source or compatibility requirements.',
		};
	}
	result.sponsorship = sponsorshipFor(
		answers,
		player,
		routes,
		integrated.length > 0 && result.conflicts.length === 0,
		rexStremio
	);
	return result;
}
