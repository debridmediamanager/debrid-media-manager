import { ApiKeyField, Card, CopyButton } from '@/components/IndexerSetup';
import { Logo } from '@/components/Logo';
import { useSponsor } from '@/hooks/useSponsor';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import {
	ArrowLeft,
	ArrowRight,
	Download,
	Handshake,
	KeyRound,
	Loader2,
	Lock,
	ShieldCheck,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';

// Setup guide for the zurg Emby plugins.
//
// Emby has no third-party plugin catalog, so unlike `/jellyfin` there is no
// repository URL to paste: each plugin is one DLL a sponsor downloads and drops
// into Emby's plugins folder. The guide is shown to everyone, because the gate is
// `/api/emby-plugins` itself, which resolves the key on every request.
//
// Downloads send the key in a header from this page rather than as a link with
// the key in it, so the key never sits in the browser history, a copied link or
// an access log.

const PRODUCTION_ORIGIN = 'https://debridmediamanager.com';

interface EmbyPlugin {
	name: string;
	account: string;
	assembly: string;
	/** What Emby's settings page calls the credential. */
	credential: string;
	/** Where the account holder gets it. */
	credentialFrom: { label: string; href?: string };
	detail: string;
}

const PLUGINS: EmbyPlugin[] = [
	{
		name: 'RD zurg',
		account: 'Real-Debrid',
		assembly: 'Emby.Plugin.RdZurg.dll',
		credential: 'API token',
		credentialFrom: {
			label: 'real-debrid.com/apitoken',
			href: 'https://real-debrid.com/apitoken',
		},
		detail: 'Plays the video inside a stored, single-volume RAR as if it were a plain file.',
	},
	{
		name: 'AD zurg',
		account: 'AllDebrid',
		assembly: 'Emby.Plugin.AdZurg.dll',
		credential: 'API key',
		credentialFrom: {
			label: 'alldebrid.com/apikeys',
			href: 'https://alldebrid.com/apikeys',
		},
		detail: 'A resync with nothing new costs a single request, however big the account is.',
	},
	{
		name: 'TB zurg',
		account: 'TorBox',
		assembly: 'Emby.Plugin.TbZurg.dll',
		credential: 'API key',
		credentialFrom: { label: 'torbox.app/settings', href: 'https://torbox.app/settings' },
		detail: 'Streams through your server, because a TorBox link carries your API key.',
	},
	{
		name: 'PM zurg',
		account: 'Premiumize',
		assembly: 'Emby.Plugin.PmZurg.dll',
		credential: 'API key',
		credentialFrom: {
			label: 'premiumize.me/account',
			href: 'https://www.premiumize.me/account',
		},
		detail: 'Links are made only when you press play, and stream through your server because a Premiumize link bills whoever holds it.',
	},
	{
		name: 'OC zurg',
		account: 'Offcloud',
		assembly: 'Emby.Plugin.OcZurg.dll',
		credential: 'API key',
		credentialFrom: { label: 'offcloud.com, under Account' },
		detail: 'A resync with nothing new is a single request. It streams through your server because an Offcloud link carries your account token.',
	},
	{
		name: 'DL zurg',
		account: 'Debrid-Link',
		assembly: 'Emby.Plugin.DlZurg.dll',
		credential: 'API token',
		credentialFrom: {
			label: 'debrid-link.com/webapp/apikey',
			href: 'https://debrid-link.com/webapp/apikey',
		},
		detail: 'Your players never see a download link, because a Debrid-Link link keeps working for anyone who has it.',
	},
];

const FOLDERS = [
	{ where: 'Docker', path: '/config/plugins', note: 'inside the container' },
	{ where: 'Linux (deb, rpm)', path: '/var/lib/emby/plugins', note: '' },
	{
		where: 'Windows',
		path: 'C:\\Users\\you\\AppData\\Roaming\\Emby-Server\\programdata\\plugins',
		note: '',
	},
	{ where: 'macOS', path: '~/.config/emby-server/plugins', note: 'or ~/emby-server/plugins' },
];

const NOT_THIS = [
	{
		title: 'Not a mount',
		detail: 'Nothing outside Emby can read this library. For Infuse, rclone or an *arr stack pointed at the same files, you want zurg.',
	},
	{
		title: 'Nothing is deleted',
		detail: 'The plugins only read your account. Nothing is added, repaired or removed on the service.',
	},
	{
		title: 'Only stored archives',
		detail: 'RD, AD and TB zurg play a stored, single-volume RAR. Everything else packed in an archive is left out of the library rather than added as something that will not play.',
	},
	{
		title: 'Eight versions a film',
		detail: 'Past eight, Emby stops grouping versions and lists every release as its own film, so the largest eight are kept.',
	},
];

/** A listing from `/api/emby-plugins/catalog.json`, as much of it as the page shows. */
interface Published {
	assembly: string;
	version: string;
	sha256: string;
}

/** Saves a response body under the name Emby expects, without a keyed URL. */
function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refusal(response: Response): Promise<string> {
	if (response.status === 404) return 'That plugin has not been published yet';
	try {
		const data = await response.json();
		if (data && typeof data.error === 'string') return data.error;
	} catch {
		// Not JSON, fall through.
	}
	return `The download failed (HTTP ${response.status})`;
}

function DownloadButton({ plugin, apiKey }: { plugin: EmbyPlugin; apiKey: string | null }) {
	const [busy, setBusy] = useState(false);

	const download = async () => {
		if (!apiKey || busy) return;
		setBusy(true);
		try {
			const response = await fetch(`/api/emby-plugins/${plugin.assembly}`, {
				headers: { 'x-api-key': apiKey },
				cache: 'no-store',
			});
			if (!response.ok) {
				toast.error(`${plugin.name}: ${await refusal(response)}`);
				return;
			}
			saveBlob(await response.blob(), plugin.assembly);
		} catch {
			toast.error(`${plugin.name}: could not reach the server`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<button
			type="button"
			onClick={download}
			disabled={!apiKey || busy}
			aria-label={`Download ${plugin.name}`}
			title={apiKey ? plugin.assembly : 'Paste your DMM API key in Settings first'}
			className="haptic-sm inline-flex shrink-0 items-center gap-1.5 rounded border-2 border-green-500/60 bg-green-900/30 px-3 py-1.5 text-xs font-medium text-green-100 transition-colors hover:bg-green-800/50 disabled:cursor-not-allowed disabled:border-gray-600 disabled:bg-gray-800/40 disabled:text-gray-500"
		>
			{busy ? (
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
			) : (
				<Download className="h-3.5 w-3.5" />
			)}
			Download
		</button>
	);
}

/** A shell line with its copy button. Never carries the key itself. */
function Command({ label, command }: { label: string; command: string }) {
	return (
		<div className="flex items-start gap-1">
			<pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-gray-800 px-2 py-1.5 font-mono text-xs text-cyan-300">
				{command}
			</pre>
			<CopyButton value={command} label={label} />
		</div>
	);
}

function SetupGuide({
	origin,
	apiKey,
	needsKeySource,
	published,
}: {
	origin: string;
	apiKey: string | null;
	needsKeySource: boolean;
	published: Record<string, Published>;
}) {
	return (
		<>
			<Card title="1. Download the ones you use">
				<p className="mb-3 text-gray-300">
					Emby has no catalog for plugins outside its own, so each one comes as a single
					file. They need <strong>Emby 4.9 or newer</strong>, which runs them on .NET 8.
					Take only the accounts you have. They do not need each other.
				</p>
				<div className="rounded bg-gray-900/60 px-3 py-1">
					{PLUGINS.map((plugin) => {
						const release = published[plugin.assembly];
						return (
							<div
								key={plugin.name}
								data-testid={`plugin-${plugin.name}`}
								className="flex flex-col gap-2 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
							>
								<code className="w-24 shrink-0 font-mono text-sm text-cyan-300">
									{plugin.name}
								</code>
								<div className="min-w-0 flex-1">
									<div className="text-sm text-gray-200">
										{plugin.account}
										{release ? (
											<span className="ml-2 text-xs text-gray-500">
												v{release.version}
											</span>
										) : null}
									</div>
									<div className="text-xs text-gray-400">{plugin.detail}</div>
									{release ? (
										<div
											className="mt-0.5 truncate font-mono text-[11px] text-gray-500"
											title={release.sha256}
										>
											sha256 {release.sha256}
										</div>
									) : null}
								</div>
								<DownloadButton plugin={plugin} apiKey={apiKey} />
							</div>
						);
					})}
				</div>
				<div className="mt-3 flex gap-2 rounded border-2 border-yellow-500/30 p-3 text-xs text-gray-300">
					<KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
					<span>
						The buttons use the DMM API key linked to this browser, the same one that
						works for the indexers and the Jellyfin plugins.{' '}
						{needsKeySource || !apiKey ? (
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
								</Link>
								.
							</>
						) : (
							'It is checked on every download, so a key you reset in gatekeeper stops working straight away.'
						)}
					</span>
				</div>

				<details className="mt-3 rounded bg-gray-900/60 px-3 py-2">
					<summary className="cursor-pointer text-sm font-medium text-gray-200">
						Downloading on a server with no browser
					</summary>
					<p className="mt-2 text-xs text-gray-400">
						Set your key in the shell first, so it stays out of the command and out of
						any log. Swap the file name for the plugin you want.
					</p>
					<div className="mt-2 rounded bg-gray-900/60 px-1">
						<ApiKeyField apiKey={apiKey} />
					</div>
					<div className="mt-2 flex flex-col gap-2">
						<Command
							label="download command"
							command={`read -rs DMM_API_KEY && export DMM_API_KEY\ncurl -fLOJ -H "X-Api-Key: $DMM_API_KEY" ${origin}/api/emby-plugins/Emby.Plugin.RdZurg.dll`}
						/>
						<Command
							label="checksum command"
							command={`curl -fsS -H "X-Api-Key: $DMM_API_KEY" ${origin}/api/emby-plugins/Emby.Plugin.RdZurg.dll.sha256 | shasum -a 256 -c`}
						/>
					</div>
				</details>
			</Card>

			<Card title="2. Put it in Emby's plugins folder">
				<p className="mb-3 text-gray-300">
					Copy the file into the <code className="text-cyan-300">plugins</code> folder of
					Emby&apos;s data folder, then restart Emby. Not sure where yours is? Emby shows
					it under Dashboard → <strong>⋯</strong> next to the server name →{' '}
					<strong>Get Server Info</strong>.
				</p>
				<div className="rounded bg-gray-900/60 px-3 py-1">
					{FOLDERS.map(({ where, path, note }) => (
						<div
							key={where}
							className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
						>
							<div className="w-36 shrink-0 text-sm font-semibold text-gray-300">
								{where}
							</div>
							<div className="min-w-0 flex-1">
								<code className="break-all font-mono text-xs text-cyan-300">
									{path}
								</code>
								{note ? (
									<span className="ml-2 text-xs text-gray-500">{note}</span>
								) : null}
							</div>
						</div>
					))}
				</div>

				<h3 className="mb-2 mt-4 text-sm font-semibold text-gray-200">Docker</h3>
				<p className="mb-2 text-xs text-gray-400">
					<code>/config</code> is the folder you mounted into the container, so the file
					can go into the host side of that mount, or straight in with{' '}
					<code>docker cp</code>. Use your container&apos;s name in place of{' '}
					<code>emby</code>.
				</p>
				<Command
					label="Docker install commands"
					command={
						'docker cp Emby.Plugin.RdZurg.dll emby:/config/plugins/\ndocker restart emby'
					}
				/>

				<h3 className="mb-2 mt-4 text-sm font-semibold text-gray-200">
					Linux, installed from the Emby package
				</h3>
				<Command
					label="Linux install commands"
					command={
						'sudo install -m 644 Emby.Plugin.RdZurg.dll /var/lib/emby/plugins/\nsudo systemctl restart emby-server'
					}
				/>

				<p className="mt-4 text-xs text-gray-400">
					On Windows and macOS, copy the file into the folder above, then quit Emby Server
					from its tray or menu bar icon and start it again. Back up the data folder first
					if this is a server you care about.
				</p>
			</Card>

			<Card title="3. Point each plugin at your account">
				<p className="text-gray-300">
					After the restart, open Emby&apos;s settings (the gear, top right) →{' '}
					<strong>Advanced</strong> → <strong>Plugins</strong>, and click the plugin.
					Paste your account&apos;s key and save.
				</p>
				<div className="mt-3 rounded bg-gray-900/60 px-3 py-1">
					{PLUGINS.map(({ name, credential, credentialFrom }) => (
						<div
							key={name}
							className="flex flex-col gap-1 border-b border-gray-700/60 py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
						>
							<code className="w-24 shrink-0 font-mono text-sm text-cyan-300">
								{name}
							</code>
							<div className="min-w-0 flex-1 text-xs text-gray-300">
								{credential} from{' '}
								{credentialFrom.href ? (
									<a
										href={credentialFrom.href}
										target="_blank"
										rel="noopener noreferrer"
										className="text-blue-300 underline hover:text-blue-200"
									>
										{credentialFrom.label}
									</a>
								) : (
									credentialFrom.label
								)}
							</div>
						</div>
					))}
				</div>
				<p className="mt-3 text-gray-300">
					Leave <strong>Server address override</strong> empty. Emby reads the stream on
					the server itself, so the default loopback address is the right one and your
					players never see it. AllDebrid emails you to confirm the key the first time a
					new server uses it.
				</p>
				<p className="mt-3 text-gray-300">
					Then run the sync under Settings → <strong>Scheduled Tasks</strong>, for example{' '}
					<em>Sync Real-Debrid library</em>. It also runs by itself every six hours. The
					first sync creates two libraries, one for movies and one for shows, named on the
					settings page. The files behind them live in the plugin&apos;s own folder under
					Emby&apos;s data folder, such as{' '}
					<code className="text-cyan-300">data/rd-zurg</code>.
				</p>
				<div className="mt-3 flex gap-2 rounded border-2 border-green-500/30 p-3 text-xs text-gray-300">
					<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
					<span>
						Every file in the library points at a signed playback address inside Emby,
						so a leaked one opens one file rather than your account. A fresh link is
						made when you press play, and scans and metadata refreshes never touch your
						account.
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
					There is no update button, because Emby has no catalog to check. When a new
					version shows up on this page, download it, replace the file and restart Emby.
					To remove a plugin, delete its file and its folder under <code>data</code>,
					since deleting the libraries in Emby leaves those files behind.
				</p>
			</Card>
		</>
	);
}

function SponsorPitch() {
	return (
		<Card title="A sponsor feature">
			<p className="text-gray-300">
				These plugins put your debrid libraries straight into Emby as ordinary movies and
				episodes, with no mount and no second service to run. The whole setup is written out
				below. The one thing it needs that this browser does not have yet is a DMM API key,
				which comes with a sponsorship.
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

export default function EmbySetupPage() {
	const { isSponsor, apiKey } = useSponsor();

	// Rendered on the client so a self-hosted instance shows its own address.
	const [origin, setOrigin] = useState(PRODUCTION_ORIGIN);
	useEffect(() => {
		if (typeof window !== 'undefined') setOrigin(window.location.origin);
	}, []);

	// Which version each plugin is at, once a key can ask. Cosmetic: a failure
	// leaves the list as it is, and a download says why it failed on its own.
	const [published, setPublished] = useState<Record<string, Published>>({});
	useEffect(() => {
		if (!apiKey) {
			setPublished({});
			return;
		}
		let cancelled = false;
		fetch('/api/emby-plugins/catalog.json', {
			headers: { 'x-api-key': apiKey },
			cache: 'no-store',
		})
			.then((response) => (response.ok ? response.json() : []))
			.then((listing: Published[]) => {
				if (cancelled || !Array.isArray(listing)) return;
				setPublished(Object.fromEntries(listing.map((entry) => [entry.assembly, entry])));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [apiKey]);

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Emby plugins</title>
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
						Put your library in Emby
					</h1>
					<p className="mt-2 text-sm text-gray-400">
						Six plugins that add your Real-Debrid, AllDebrid, TorBox, Premiumize,
						Offcloud and Debrid-Link libraries to Emby as ordinary movies and shows. No
						mount, no rclone, no second service.
					</p>
					<Link
						href="/jellyfin"
						className="mt-2 inline-flex items-center gap-1 text-sm text-blue-300 underline hover:text-blue-200"
					>
						Using Jellyfin? Those plugins install from a repository
						<ArrowRight className="h-3.5 w-3.5" />
					</Link>
				</header>

				{isSponsor ? null : <SponsorPitch />}
				<SetupGuide
					origin={origin}
					apiKey={apiKey}
					needsKeySource={isSponsor && !apiKey}
					published={published}
				/>
			</div>
		</div>
	);
}
