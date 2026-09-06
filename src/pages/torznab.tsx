import { Logo } from '@/components/Logo';
import { useSponsor } from '@/hooks/useSponsor';
import { Check, Copy, Handshake, KeyRound, Lock, Zap } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';

// Setup guide for pointing Prowlarr / Sonarr / Radarr at DMM's Torznab endpoint.
//
// The sponsor check below is COSMETIC ONLY. It reads the unverified sponsor
// token out of localStorage, so anyone can flip it by hand; the real gate is
// `/api/torznab/api` itself, which verifies the DMM API key server-side on every
// request. This page only decides what to *show*, never what to allow.

const PRODUCTION_ORIGIN = 'https://debridmediamanager.com';
const GATEKEEPER_URL = 'https://gatekeeper.debridmediamanager.com';

/** The path segment an *arr appends to the indexer URL. */
const API_PATH = '/api';

const LIMITS = [
	{ label: '20 searches', per: 'per minute, per key' },
	{ label: 'No grab limit', per: 'grabs never come back to DMM' },
];

const CATEGORIES = [
	{ id: '2000', name: 'Movies' },
	{ id: '2030', name: 'Movies / SD' },
	{ id: '2040', name: 'Movies / HD' },
	{ id: '2045', name: 'Movies / UHD' },
	{ id: '5000', name: 'TV' },
	{ id: '5030', name: 'TV / SD' },
	{ id: '5040', name: 'TV / HD' },
	{ id: '5045', name: 'TV / UHD' },
];

const SEARCH_MODES = [
	{
		mode: 'search',
		what: 'Free-text search',
		detail: 'q= anything. With no query at all it answers with what was scraped most recently.',
	},
	{
		mode: 'tvsearch',
		what: 'TV by series id',
		detail: 'imdbid= or tvdbid=, with season= and ep=. Sonarr sends this.',
	},
	{
		mode: 'movie',
		what: 'Movies by IMDb id',
		detail: 'imdbid=, with or without the tt prefix. Radarr sends this.',
	},
];

/** The path variants, and what each one changes about the feed. */
const FEEDS = [
	{ suffix: '', what: 'Everything DMM has, cached or not' },
	{ suffix: '/cached', what: 'Only releases already cached on Real-Debrid or AllDebrid' },
	{ suffix: '/rd', what: 'Cache signal read from Real-Debrid only' },
	{ suffix: '/ad', what: 'Cache signal read from AllDebrid only' },
	{ suffix: '/rd/cached', what: 'Only what Real-Debrid already holds' },
];

function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<button
			type="button"
			aria-label={`Copy ${label}`}
			className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
				} catch {
					toast.error('Could not reach the clipboard — copy it by hand');
				}
			}}
		>
			{copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
		</button>
	);
}

/** One row of *arr's Add Indexer → Torznab form. */
function Field({
	label,
	value,
	hint,
	copyable = true,
}: {
	label: string;
	value: string;
	hint?: string;
	copyable?: boolean;
}) {
	return (
		<div
			data-testid={`field-${label}`}
			className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
		>
			<div className="w-32 shrink-0 text-sm font-semibold text-gray-300">{label}</div>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<code className="min-w-0 flex-1 truncate rounded bg-gray-800 px-2 py-1.5 font-mono text-sm text-cyan-300">
					{value}
				</code>
				{copyable ? <CopyButton value={value} label={label} /> : null}
			</div>
			{hint ? <div className="text-xs text-gray-500 sm:w-56 sm:shrink-0">{hint}</div> : null}
		</div>
	);
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="w-full rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-5 shadow">
			<h2 className="mb-3 text-lg font-semibold text-gray-100">{title}</h2>
			<div className="text-sm text-gray-200">{children}</div>
		</section>
	);
}

function SetupGuide({ indexerUrl }: { indexerUrl: string }) {
	return (
		<>
			<Card title="1. Paste this into Prowlarr / Sonarr / Radarr">
				<p className="mb-3 text-gray-300">
					Prowlarr: Settings → Indexers → <strong>+</strong> → <strong>Torznab</strong>{' '}
					(the generic one). Sonarr and Radarr take the same three values under Settings →
					Indexers → <strong>+</strong> → <strong>Torznab</strong> if you would rather
					skip Prowlarr.
				</p>
				<div className="rounded bg-gray-900/60 px-3 py-1">
					<Field label="URL" value={indexerUrl} hint="this DMM instance" />
					<Field label="API Path" value={API_PATH} hint="appended to the URL above" />
					<Field
						label="API Key"
						value="your DMM API key from gatekeeper"
						copyable={false}
						hint="paste it yourself — DMM never shows it"
					/>
				</div>
				<div className="mt-3 flex gap-2 rounded border-2 border-yellow-500/30 p-3 text-xs text-gray-300">
					<KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
					<span>
						The key is the same 64-character DMM API key you get by connecting your
						GitHub account on{' '}
						<a
							href={GATEKEEPER_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="underline decoration-dotted"
						>
							gatekeeper
						</a>
						, and the same one the Usenet indexer uses.
					</span>
				</div>
			</Card>

			<Card title="2. What you can search for">
				<div className="rounded bg-gray-900/60 px-3 py-1">
					{SEARCH_MODES.map(({ mode, what, detail }) => (
						<div
							key={mode}
							data-testid={`mode-${mode}`}
							className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
						>
							<code className="w-28 shrink-0 font-mono text-sm text-cyan-300">
								t={mode}
							</code>
							<div className="min-w-0 flex-1">
								<div className="text-sm text-gray-200">{what}</div>
								<div className="text-xs text-gray-400">{detail}</div>
							</div>
						</div>
					))}
				</div>
				<p className="mt-3 text-xs text-gray-400">
					A title nobody has looked up yet is scraped while your search waits, so an empty
					first answer is worth repeating once before blaming the indexer.
				</p>
			</Card>

			<Card title="3. Cached-only variants">
				<p className="mb-3 text-gray-300">
					Every release is reported with a seeder count that says whether it is already
					cached on a debrid service — cached releases come back as 100 seeders,
					everything else as 1 — because nothing here is downloaded from a swarm. Add a
					suffix to the URL to narrow the feed instead:
				</p>
				<div className="rounded bg-gray-900/60 px-3 py-1">
					{FEEDS.map(({ suffix, what }) => (
						<div
							key={suffix || 'plain'}
							data-testid={`feed-${suffix || 'plain'}`}
							className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
						>
							<code className="w-40 shrink-0 font-mono text-sm text-cyan-300">
								/api/torznab{suffix}
							</code>
							<div className="min-w-0 flex-1 text-xs text-gray-400">{what}</div>
						</div>
					))}
				</div>
			</Card>

			<Card title="4. Categories it advertises">
				<div className="flex flex-wrap gap-2">
					{CATEGORIES.map(({ id, name }) => (
						<span
							key={id}
							className="rounded border border-gray-600 bg-gray-900/60 px-2 py-1 font-mono text-xs text-cyan-300"
						>
							{id}
							<span className="ml-1.5 font-sans text-gray-400">{name}</span>
						</span>
					))}
				</div>
				<p className="mt-3 text-xs text-gray-400">
					Map the parent categories rather than only the subcategories: a release whose
					name never states a resolution is labelled 2000 or 5000 and nothing else, so a
					HD-only mapping hides it.
				</p>
			</Card>

			<Card title="5. Limits, per key">
				<div className="grid gap-3 sm:grid-cols-2">
					{LIMITS.map(({ label, per }) => (
						<div
							key={label}
							className="rounded border-2 border-gray-600/50 px-3 py-2 text-center"
						>
							<div className="text-base font-semibold text-gray-100">{label}</div>
							<div className="text-xs text-gray-400">{per}</div>
						</div>
					))}
				</div>
				<p className="mt-3 text-xs text-gray-400">
					Counted against your DMM API key, not your IP, so several *arr instances behind
					one key share the budget. Cap Prowlarr&apos;s RSS sync interval rather than
					letting a full library search run unthrottled.
				</p>
			</Card>

			<Card title="6. Where the grabs go">
				<p className="text-gray-300">
					Every result is a magnet link, so point your *arr at any download client that
					adds magnets to your debrid account. DMM is not in that path at all — it hands
					over the infohash and your own account does the rest.
				</p>
				<div className="mt-3 flex gap-2 rounded border-2 border-green-500/30 p-3 text-xs text-gray-300">
					<Zap className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
					<span>
						Results come from DMM&apos;s own torrent library. If you want your *arr to
						only ever grab things that download instantly, use the{' '}
						<code className="text-cyan-300">/cached</code> variant above.
					</span>
				</div>
			</Card>
		</>
	);
}

function SponsorPitch() {
	return (
		<Card title="Sponsors only">
			<p className="text-gray-300">
				The torrent indexer is a sponsor feature. It answers Prowlarr, Sonarr and Radarr as
				a Torznab indexer backed by DMM&apos;s own library, so your *arr stack can search it
				like any other tracker and hand the magnets to your debrid account.
			</p>

			<div className="mt-4 rounded border-2 border-pink-500/30 p-4 text-center">
				<div className="mb-2 flex items-center justify-center gap-2 text-sm font-medium text-pink-200">
					<Handshake className="h-4 w-4 text-pink-400" />
					Sponsor this project&apos;s development
				</div>
				<div className="text-sm text-gray-300">
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://github.com/sponsors/debridmediamanager"
						target="_blank"
						rel="noopener noreferrer"
					>
						Github
					</a>{' '}
					|{' '}
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://www.patreon.com/debridmediamanager"
						target="_blank"
						rel="noopener noreferrer"
					>
						Patreon
					</a>{' '}
					|{' '}
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://paypal.me/yowmamasita"
						target="_blank"
						rel="noopener noreferrer"
					>
						Paypal
					</a>
				</div>
			</div>

			<p className="mt-4 text-sm text-gray-400">
				Already sponsoring? Paste your DMM API key in{' '}
				<Link href="/settings" className="text-blue-300 underline hover:text-blue-200">
					Settings
				</Link>{' '}
				to link this browser. Get the key by connecting your GitHub account on{' '}
				<a
					href={GATEKEEPER_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-300 underline hover:text-blue-200"
				>
					gatekeeper
				</a>
				.
			</p>
		</Card>
	);
}

export default function TorznabSetupPage() {
	const { isSponsor } = useSponsor();

	// Rendered on the client: the host depends on where DMM is served from, so a
	// self-hosted or localhost instance gets its own URL rather than the public
	// one. Starts at production so the server-rendered markup matches the first
	// client render.
	const [origin, setOrigin] = useState(PRODUCTION_ORIGIN);
	useEffect(() => {
		if (typeof window !== 'undefined') setOrigin(window.location.origin);
	}, []);

	const indexerUrl = `${origin}/api/torznab`;

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Torrent indexer setup</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />
			<Toaster position="bottom-right" />

			<div className="mt-6 flex w-full max-w-3xl flex-col gap-5 pb-16">
				<header>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
						{isSponsor ? null : <Lock className="h-5 w-5 text-pink-400" />}
						Use DMM as a torrent indexer
					</h1>
					<p className="mt-2 text-sm text-gray-400">
						DMM answers as a Torznab indexer, so Prowlarr, Sonarr and Radarr can search
						its torrent library like any other tracker.
					</p>
				</header>

				{isSponsor ? <SetupGuide indexerUrl={indexerUrl} /> : <SponsorPitch />}
			</div>
		</div>
	);
}
