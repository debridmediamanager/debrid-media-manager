import { Card } from '@/components/IndexerSetup';
import { Logo } from '@/components/Logo';
import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/configs';
import { SAB_DAILY } from '@/services/sabnzbdProxy';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import { ArrowLeft, Lock } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';

// Every DMM endpoint meant for another program to call. The routes the site
// calls for itself (problem-token searches, availability checks, OAuth, Cast
// internals) and the fleet's secret-gated ones stay off this list on purpose.

type Endpoint = {
	method: string;
	path: string;
	what: string;
	auth: string;
	limit?: string;
	guide?: { href: string; label: string };
	sponsor?: boolean;
};

const perMinute = (config: { rateLimit: number; windowSeconds: number }, unit: string) =>
	`${config.rateLimit} ${unit} per ${config.windowSeconds === 60 ? 'minute' : `${config.windowSeconds}s`}`;

const { newznabSearch, newznabGrab, newznabGrabDay, torznabSearch, zurg, identifyHashes } =
	RATE_LIMIT_CONFIGS;

const perAddress = `${RATE_LIMIT_CONFIGS.default.rateLimit} requests per second`;

const SECTIONS: { title: string; endpoints: Endpoint[] }[] = [
	{
		title: 'Open to everyone',
		endpoints: [
			{
				method: 'GET',
				path: '/api/stremio/<your id>/manifest.json',
				what: 'Your DMM Cast addon for Stremio. TorBox, AllDebrid, Premiumize, Debrid-Link and Offcloud have their own under /api/stremio-tb, -ad, -pm, -dl and -oc.',
				auth: 'The id in the install link',
				limit: `${RATE_LIMIT_CONFIGS.stream.rateLimit} stream list per title every ${RATE_LIMIT_CONFIGS.stream.windowSeconds}s`,
				guide: { href: '/stremio', label: 'DMM Cast' },
			},
			{
				method: 'GET/POST',
				path: '/api/sabnzbd/<mount root>/api',
				what: `A SABnzbd download client for Sonarr and Radarr. Grabs are rebuilt as torrents in your Real-Debrid account, under the same daily allowance as DMM's own pages: ${SAB_DAILY.normal} of Usenet per account, ${SAB_DAILY.sponsor} and a place ahead in the queue for sponsors, while the sponsorship is active.`,
				auth: 'Your Real-Debrid API key as the API Key. Sponsors add their DMM API key as the Password',
				limit: perAddress,
				guide: { href: '/sabnzbd', label: 'SABnzbd setup' },
			},
			{
				method: 'POST',
				path: '/api/takedown',
				what: 'File a copyright notice. Notices wait for review before anything is removed.',
				auth: 'None',
				limit: `${RATE_LIMIT_CONFIGS.takedown.rateLimit} notices per hour`,
				guide: { href: '/copyright', label: 'Notice form' },
			},
		],
	},
	{
		title: 'Sponsors only',
		endpoints: [
			{
				method: 'GET',
				path: '/api/torznab/api',
				what: "DMM's torrent library as a Torznab indexer for Prowlarr, Sonarr and Radarr. Feeds such as /api/torznab/rd/cached sit under the same path.",
				auth: '?apikey=',
				limit: perMinute(torznabSearch, 'pages'),
				guide: { href: '/torznab', label: 'Torrent indexer setup' },
			},
			{
				method: 'GET',
				path: '/api/newznab/api',
				what: 'Usenet search as a Newznab indexer for Prowlarr, Sonarr and Radarr.',
				auth: '?apikey=',
				limit: `${perMinute(newznabSearch, 'searches')}, ${perMinute(newznabGrab, 'grabs')}, ${newznabGrabDay.rateLimit} grabs per day`,
				guide: { href: '/newznab', label: 'Usenet indexer setup' },
			},
			{
				method: 'GET',
				path: '/api/plugins/manifest.json',
				what: 'The plugin repository for the zurg Jellyfin plugins.',
				auth: '?apikey=',
				limit: perAddress,
				guide: { href: '/jellyfin', label: 'Jellyfin plugins' },
			},
			{
				method: 'GET',
				path: '/api/emby-plugins/',
				what: 'Downloads of the zurg Emby plugins.',
				auth: '?apikey=',
				limit: perAddress,
				guide: { href: '/emby', label: 'Emby plugins' },
			},
			{
				method: 'POST',
				path: '/api/sponsor/identify',
				what: 'Works out the movie or show from each release filename, the same way your library page does, so it answers for releases DMM has never seen. Up to 500 filenames a call.',
				auth: 'x-api-key header',
				limit: perMinute(RATE_LIMIT_CONFIGS.sponsorIdentify, 'calls'),
			},
			{
				method: 'POST',
				path: '/api/sponsor/availability',
				what: 'Which hashes DMM users have found cached on Real-Debrid or AllDebrid, with their files. Up to 100 hashes a call, optionally for one IMDb id.',
				auth: 'x-api-key header',
				limit: perMinute(RATE_LIMIT_CONFIGS.sponsorAvailability, 'calls'),
			},
			{
				method: 'POST',
				path: '/api/torrents/identify',
				what: 'Looks up the title DMM already has on record for each release hash, without reading any filename. Hashes DMM has never seen are left out, so use /api/sponsor/identify for those. Up to 500 hashes a call.',
				auth: 'x-api-key header',
				limit: perMinute(identifyHashes, 'calls'),
			},
			{
				method: 'POST',
				path: '/api/zurg/search-torrents',
				what: 'Cached releases for an IMDb id, biggest first, with quality and size filters.',
				auth: 'x-api-key header',
				limit: perMinute(zurg, 'calls'),
			},
			{
				method: 'POST',
				path: '/api/zurg/show-info',
				what: 'Seasons and episode counts for a show by IMDb id.',
				auth: 'x-api-key header',
				limit: perMinute(zurg, 'calls'),
			},
			{
				method: 'POST',
				path: '/api/zurg/resolve-tmdb',
				what: 'The IMDb id for a TMDB movie or show id.',
				auth: 'x-api-key header',
				limit: perMinute(zurg, 'calls'),
			},
		].map((endpoint) => ({ ...endpoint, sponsor: true })),
	},
];

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
	const { method, path, what, auth, limit, guide, sponsor } = endpoint;
	return (
		<div
			data-testid={`endpoint-${path}`}
			className="flex flex-col gap-1 border-b border-gray-700/60 py-3 last:border-b-0"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="rounded bg-gray-700 px-1.5 py-0.5 font-mono text-xs text-gray-200">
					{method}
				</span>
				<code className="break-all font-mono text-sm text-cyan-300">{path}</code>
				{sponsor ? (
					<a
						href={GATEKEEPER_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 rounded border border-pink-500/50 px-1.5 py-0.5 text-xs text-pink-200 hover:bg-pink-500/10"
					>
						<Lock className="h-3 w-3" aria-hidden="true" />
						Sponsors only
					</a>
				) : null}
			</div>
			<div className="text-sm text-gray-200">{what}</div>
			<div className="text-xs text-gray-400">
				Auth: {auth}
				{limit ? <> · Limit: {limit}</> : null}
				{guide ? (
					<>
						{' · '}
						<Link href={guide.href} className="underline decoration-dotted">
							{guide.label}
						</Link>
					</>
				) : null}
			</div>
		</div>
	);
}

export default function ApiDocsPage() {
	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - API</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />

			<div className="mt-6 flex w-full max-w-3xl flex-col gap-5 pb-16">
				<Link
					href="/"
					className="inline-flex w-full items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to dashboard</span>
				</Link>
				<header>
					<h1 className="text-2xl font-bold text-gray-100">DMM API</h1>
					<p className="mt-2 text-sm text-gray-400">
						Endpoints your own apps and tools can call. The ones marked Sponsors only
						take the 64-character DMM API key you get by connecting your GitHub account
						on{' '}
						<a
							href={GATEKEEPER_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="underline decoration-dotted"
						>
							gatekeeper
						</a>
						. Limits count per address unless a guide says per key, and a refused call
						answers 429 with Retry-After.
					</p>
				</header>

				{SECTIONS.map(({ title, endpoints }) => (
					<Card key={title} title={title}>
						<div className="rounded bg-gray-900/60 px-3">
							{endpoints.map((endpoint) => (
								<EndpointRow key={endpoint.path} endpoint={endpoint} />
							))}
						</div>
					</Card>
				))}
			</div>
		</div>
	);
}
