import { Card, Field, maskApiKey } from '@/components/IndexerSetup';
import { Logo } from '@/components/Logo';
import { useSponsor } from '@/hooks/useSponsor';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import { ArrowLeft, Eye, EyeOff, Handshake, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

// Setup guide for adding DMM as a plugin repository in Jellyfin.
//
// Same shape as `/newznab` and `/torznab`, and the same reasoning about what is
// hidden: the guide is shown to everyone because the gate is `/api/plugins`
// itself, which resolves the key against the sponsorship on every request. The
// sponsor check below only decides whether to put the pitch above the guide.
//
// The one difference from the indexer pages is that the credential is inside a
// URL rather than in a field of its own, because Jellyfin has nowhere else to
// put one. So the URL is masked the same way a key is.

const PRODUCTION_ORIGIN = 'https://debridmediamanager.com';

/** What Jellyfin calls the repository once it is added. */
const REPOSITORY_NAME = 'zurg for Jellyfin';

const PLUGINS = [
	{
		name: 'RD zurg',
		account: 'Real-Debrid',
		detail: 'Reads through the RAR wrappers Real-Debrid serves without declaring them.',
	},
	{
		name: 'AD zurg',
		account: 'AllDebrid',
		detail: 'One call per twenty magnets, so a resync over a big account stays cheap.',
	},
	{
		name: 'TB zurg',
		account: 'TorBox',
		detail: 'Streams through your server, because a TorBox link carries your API key.',
	},
	{
		name: 'NZB zurg',
		account: 'Usenet',
		detail: 'Point it at a folder of NZBs. Nothing is downloaded until you press play.',
	},
];

const NOT_THIS = [
	{
		title: 'Not a mount',
		detail: 'Nothing outside Jellyfin can read this library. For Infuse, rclone or an *arr stack pointed at the same files, you want zurg.',
	},
	{
		title: 'Only stored archives',
		detail: 'A compressed or encrypted archive is left out of the library rather than added as something that will not play.',
	},
	{
		title: 'No downloader',
		detail: 'Nothing is fetched until something plays, and nothing is kept afterwards.',
	},
];

/**
 * The repository URL, with the key inside it masked.
 *
 * A setup page is exactly what someone screenshots while wiring up a server, and
 * this URL is a credential in its own right. The copy button hands over the real
 * one without ever putting it on screen.
 */
function RepositoryUrlField({ origin, apiKey }: { origin: string; apiKey: string | null }) {
	const [revealed, setRevealed] = useState(false);

	if (!apiKey) {
		return (
			<Field
				label="Repository URL"
				value={`${origin}/api/plugins/manifest.json?apikey=your DMM API key`}
				copyable={false}
				hint="paste your key in Settings to fill this in"
			/>
		);
	}

	const url = `${origin}/api/plugins/manifest.json?apikey=${apiKey}`;
	const masked = `${origin}/api/plugins/manifest.json?apikey=${maskApiKey(apiKey)}`;

	return (
		<Field
			label="Repository URL"
			value={revealed ? url : masked}
			copyValue={url}
			hint="carries your key, so treat it like the key"
			extra={
				<button
					type="button"
					aria-label={revealed ? 'Hide repository URL' : 'Reveal repository URL'}
					className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
					onClick={() => setRevealed((current) => !current)}
				>
					{revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
				</button>
			}
		/>
	);
}

function SetupGuide({
	origin,
	apiKey,
	needsKeySource,
}: {
	origin: string;
	apiKey: string | null;
	needsKeySource: boolean;
}) {
	return (
		<>
			<Card title="1. Add the repository to Jellyfin">
				<p className="mb-3 text-gray-300">
					In Jellyfin: Dashboard → Plugins → <strong>Repositories</strong> →{' '}
					<strong>+</strong>. It needs Jellyfin 12.
				</p>
				<div className="rounded bg-gray-900/60 px-3 py-1">
					<Field
						label="Repository Name"
						value={REPOSITORY_NAME}
						hint="anything you like, this is just the label"
					/>
					<RepositoryUrlField origin={origin} apiKey={apiKey} />
				</div>
				<div className="mt-3 flex gap-2 rounded border-2 border-yellow-500/30 p-3 text-xs text-gray-300">
					<KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
					<span>
						The same 64-character DMM API key works for the two indexers as well.{' '}
						{needsKeySource ? (
							<>
								Get it by connecting your GitHub account on{' '}
								<a
									href={GATEKEEPER_URL}
									target="_blank"
									rel="noopener noreferrer"
									className="underline decoration-dotted"
								>
									gatekeeper
								</a>
								, then paste it in{' '}
								<Link href="/settings" className="underline decoration-dotted">
									Settings
								</Link>{' '}
								to fill it in here.
							</>
						) : (
							'Jellyfin stores this URL in its own settings and shows it on that Repositories page, so anyone who can open your dashboard can read your key off it.'
						)}
					</span>
				</div>
			</Card>

			<Card title="2. Install the ones you use">
				<p className="mb-3 text-gray-300">
					Dashboard → Plugins → <strong>Catalog</strong>, then restart Jellyfin. Install
					only the accounts you have. They do not need each other.
				</p>
				<div className="rounded bg-gray-900/60 px-3 py-1">
					{PLUGINS.map(({ name, account, detail }) => (
						<div
							key={name}
							data-testid={`plugin-${name}`}
							className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
						>
							<code className="w-24 shrink-0 font-mono text-sm text-cyan-300">
								{name}
							</code>
							<div className="min-w-0 flex-1">
								<div className="text-sm text-gray-200">{account}</div>
								<div className="text-xs text-gray-400">{detail}</div>
							</div>
						</div>
					))}
				</div>
			</Card>

			<Card title="3. Point each plugin at your account">
				<p className="text-gray-300">
					Dashboard → Plugins → the plugin → <strong>Settings</strong>. Each one wants
					your account key and the address your players reach this Jellyfin at.{' '}
					<strong>localhost will not do</strong>, because the address is written into
					every item and your players resolve it too. NZB zurg wants a news server and a
					folder of NZBs instead of an account key.
				</p>
				<p className="mt-3 text-gray-300">
					Then run the sync under Dashboard → <strong>Scheduled Tasks</strong>. It also
					runs by itself every six hours. A first pass over a few thousand torrents takes
					a couple of minutes, and every pass after that is much cheaper.
				</p>
				<div className="mt-3 flex gap-2 rounded border-2 border-green-500/30 p-3 text-xs text-gray-300">
					<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
					<span>
						Playback URLs are signed per file, so nothing that reaches a player can be
						replayed against your account for anything else. Changing your account key
						re-signs the library on the next sync without disturbing what you have
						watched.
					</span>
				</div>
			</Card>

			<Card title="4. What they will not do">
				<div className="rounded bg-gray-900/60 px-3 py-1">
					{NOT_THIS.map(({ title, detail }) => (
						<div
							key={title}
							className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
						>
							<div className="w-40 shrink-0 text-sm font-semibold text-gray-300">
								{title}
							</div>
							<div className="min-w-0 flex-1 text-xs text-gray-400">{detail}</div>
						</div>
					))}
				</div>
				<p className="mt-3 text-xs text-gray-400">
					Updates arrive the same way anything else in Jellyfin does. When a new version
					is published the Catalog offers it, so there is nothing to download by hand.
				</p>
			</Card>
		</>
	);
}

function SponsorPitch() {
	return (
		<Card title="A sponsor feature">
			<p className="text-gray-300">
				These plugins put your debrid and Usenet libraries straight into Jellyfin as
				ordinary movies and episodes, with no mount and no second service to run. The whole
				setup is written out below. The one thing it needs that this browser does not have
				yet is a DMM API key, which comes with a sponsorship.
			</p>

			<div className="mt-4 rounded border-2 border-pink-500/30 p-4 text-center">
				<div className="mb-2 flex items-center justify-center gap-2 text-sm font-medium text-pink-200">
					<Handshake className="h-4 w-4 text-pink-400" />
					Sponsor this project&apos;s development
				</div>
				<div className="text-sm text-gray-300">
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href={GATEKEEPER_URL}
						target="_blank"
						rel="noopener noreferrer"
					>
						gatekeeper
					</a>
				</div>
			</div>

			<p className="mt-4 text-sm text-gray-400">
				Get your key by connecting your GitHub account there, then paste it in{' '}
				<Link href="/settings" className="text-blue-300 underline hover:text-blue-200">
					Settings
				</Link>{' '}
				to link this browser. Already sponsoring on another machine? It is the same key on
				this one, so there is nothing to pay twice.
			</p>
		</Card>
	);
}

export default function JellyfinSetupPage() {
	const { isSponsor, apiKey } = useSponsor();

	// Rendered on the client: a self-hosted or localhost instance should show its
	// own address rather than the public one. Starts at production so the
	// server-rendered markup matches the first client render.
	const [origin, setOrigin] = useState(PRODUCTION_ORIGIN);
	useEffect(() => {
		if (typeof window !== 'undefined') setOrigin(window.location.origin);
	}, []);

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Jellyfin plugins</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />
			<Toaster position="bottom-right" />

			<div className="mt-6 flex w-full max-w-3xl flex-col gap-5 pb-16">
				<Link
					href="/"
					className="inline-flex w-full items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to dashboard</span>
				</Link>
				<header>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
						{isSponsor ? null : <Lock className="h-5 w-5 text-pink-400" />}
						Put your library in Jellyfin
					</h1>
					<p className="mt-2 text-sm text-gray-400">
						Four plugins that add your Real-Debrid, AllDebrid, TorBox and Usenet
						libraries to Jellyfin as ordinary movies and shows. No mount, no rclone, no
						second service.
					</p>
				</header>

				{isSponsor ? null : <SponsorPitch />}
				<SetupGuide origin={origin} apiKey={apiKey} needsKeySource={isSponsor && !apiKey} />
			</div>
		</div>
	);
}
