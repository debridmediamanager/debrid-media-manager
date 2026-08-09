import { Logo } from '@/components/Logo';
import { needsUsernameSlot, sabUrlBase } from '@/services/sabnzbdProxy';
import { AlertTriangle, Check, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import Head from 'next/head';
import { useEffect, useMemo, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';

// Setup guide for pointing Radarr/Sonarr at DMM as a SABnzbd download client.
//
// Unlisted on purpose: nothing links here, and it is `noindex, nofollow`. The
// endpoint it documents (`/api/sabnzbd/**/api`) spends the operator's Usenet
// bandwidth, so the URL is handed out rather than advertised.

/** What nzb2rd ships with; `mode=get_config` reports the real list on Test. */
const DEFAULT_CATEGORIES = ['*', 'movies', 'tv', 'sonarr', 'radarr', 'anime'];

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

/** One row of *arr's Add Download Client → SABnzbd form. */
function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<div
			data-testid={`field-${label}`}
			className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
		>
			<div className="w-40 shrink-0 text-sm font-semibold text-gray-300">{label}</div>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<code className="min-w-0 flex-1 truncate rounded bg-gray-800 px-2 py-1.5 font-mono text-sm text-cyan-300">
					{value || <span className="text-gray-500">(leave blank)</span>}
				</code>
				{value ? <CopyButton value={value} label={label} /> : null}
			</div>
			{hint ? <div className="text-xs text-gray-500 sm:w-48 sm:shrink-0">{hint}</div> : null}
		</div>
	);
}

/**
 * Three states, not two. `unknown` is for a check that could not run — painting
 * that red would accuse a token nothing is actually wrong with.
 */
function Result({
	ok,
	unknown,
	title,
	children,
}: {
	ok: boolean;
	unknown?: boolean;
	title: string;
	children?: React.ReactNode;
}) {
	const tone = ok
		? { border: 'border-green-500/40', text: 'text-green-400' }
		: unknown
			? { border: 'border-yellow-500/40', text: 'text-yellow-400' }
			: { border: 'border-red-500/40', text: 'text-red-400' };

	return (
		<div className={`rounded border-2 p-3 text-sm ${tone.border}`}>
			<div className={`flex items-center gap-2 font-semibold ${tone.text}`}>
				{ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
				{title}
			</div>
			{children ? <div className="mt-2 text-xs text-gray-300">{children}</div> : null}
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

/**
 * The token is checked against Real-Debrid directly, and that is the point of
 * this button.
 *
 * Neither *arr's own Test nor the SABnzbd endpoint can catch a wrong token: the
 * endpoint only rejects an **empty** one, and the key is not handed to
 * Real-Debrid until a release is actually grabbed. So a typo'd token sails
 * through *arr's connection test and then fails every download afterwards.
 */
type TokenResult =
	| { ok: true; username: string; premium: boolean }
	/** `unknown` when the check itself could not run — never blame the token then. */
	| { ok: false; unknown?: boolean; message: string };

type ServiceResult =
	| { ok: true; completeDir: string; categories: string[] }
	| { ok: false; message: string };

type TestState =
	| { kind: 'idle' }
	| { kind: 'running' }
	| { kind: 'done'; token: TokenResult; service: ServiceResult };

export default function SabnzbdSetupPage() {
	const [mountRoot, setMountRoot] = useState('/mnt/zurg/__all__');
	const [apiKey, setApiKey] = useState('');
	const [showKey, setShowKey] = useState(false);
	const [category, setCategory] = useState('movies');
	const [test, setTest] = useState<TestState>({ kind: 'idle' });

	// Rendered on the client only: the host depends on where this page is served
	// from, so a server-rendered guess would be wrong on a self-hosted DMM.
	const [origin, setOrigin] = useState('');
	useEffect(() => setOrigin(window.location.origin), []);

	const viaUsername = needsUsernameSlot(mountRoot);
	const urlBase = sabUrlBase(mountRoot);
	const host = useMemo(() => (origin ? new URL(origin).hostname : ''), [origin]);
	const port = useMemo(() => {
		if (!origin) return '';
		const url = new URL(origin);
		return url.port || (url.protocol === 'https:' ? '443' : '80');
	}, [origin]);
	const useSsl = origin.startsWith('https:');

	async function checkToken(key: string): Promise<TokenResult> {
		try {
			const response = await fetch('/api/realdebrid/validate-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: key }),
			});
			const body = await response.json();
			if (body?.valid === true) {
				return { ok: true, username: String(body.username), premium: !!body.premium };
			}
			if (body?.valid === false) {
				return { ok: false, message: 'Real-Debrid did not accept this token' };
			}
			return { ok: false, unknown: true, message: 'Could not check the token right now' };
		} catch {
			return { ok: false, unknown: true, message: 'Could not check the token right now' };
		}
	}

	async function checkService(key: string): Promise<ServiceResult> {
		const params = new URLSearchParams({ mode: 'get_config', apikey: key });
		if (viaUsername) params.set('ma_username', mountRoot.trim());
		try {
			const body = await (await fetch(`/${urlBase}/api?${params}`)).json();
			if (body?.status === false) {
				return { ok: false, message: String(body.error ?? 'rejected') };
			}
			const misc = body?.config?.misc;
			if (!misc) {
				return { ok: false, message: 'Unexpected reply — is the service reachable?' };
			}
			return {
				ok: true,
				completeDir: String(misc.complete_dir ?? ''),
				categories: Array.isArray(misc.categories) ? misc.categories.map(String) : [],
			};
		} catch {
			return { ok: false, message: 'The request failed before it got an answer' };
		}
	}

	async function runTest() {
		const key = apiKey.trim();
		if (!key) {
			toast.error('Enter your Real-Debrid API token first');
			return;
		}
		setTest({ kind: 'running' });
		const [token, service] = await Promise.all([checkToken(key), checkService(key)]);
		setTest({ kind: 'done', token, service });
	}

	const categories =
		test.kind === 'done' && test.service.ok && test.service.categories.length
			? test.service.categories
			: DEFAULT_CATEGORIES;

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Radarr / Sonarr setup</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />
			<Toaster position="bottom-right" />

			<div className="mt-6 flex w-full max-w-3xl flex-col gap-5 pb-16">
				<header>
					<h1 className="text-2xl font-bold text-gray-100">
						Use DMM as a download client in Radarr / Sonarr
					</h1>
					<p className="mt-2 text-sm text-gray-400">
						DMM can pretend to be a SABnzbd server. Radarr and Sonarr grab a release
						from your Usenet indexer as usual, DMM pulls it off Usenet, rebuilds it as a
						torrent and adds it to <strong>your own</strong> Real-Debrid account. The
						finished release appears in your zurg/rclone mount, and *arr imports it from
						there.
					</p>
				</header>

				<Card title="1. Your Real-Debrid API token">
					<p className="mb-3 text-gray-300">
						This is both your password and your identity here — jobs are filed under it,
						so *arr only ever sees your own queue. It goes in SABnzbd&apos;s{' '}
						<strong>API Key</strong> field.
					</p>
					<div className="flex items-center gap-2">
						<input
							type={showKey ? 'text' : 'password'}
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="Paste your Real-Debrid API token"
							className="w-full rounded bg-gray-800 px-2 py-2.5 font-mono text-sm text-gray-200"
							spellCheck={false}
							autoComplete="off"
						/>
						<button
							type="button"
							aria-label={showKey ? 'Hide token' : 'Show token'}
							className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-gray-100"
							onClick={() => setShowKey((v) => !v)}
						>
							{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
						</button>
					</div>
					<p className="mt-2 text-xs text-gray-400">
						Get it at{' '}
						<a
							href="https://real-debrid.com/apitoken"
							target="_blank"
							rel="noopener noreferrer"
							className="underline decoration-dotted"
						>
							real-debrid.com/apitoken
						</a>
						. Nothing is stored — this page keeps it in the browser tab only, and it is
						cleared when you close it.
					</p>
					<div className="mt-3 flex gap-2 rounded border-2 border-yellow-500/30 p-3 text-xs text-gray-300">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
						<span>
							Use the <strong>permanent API token</strong> from that page, not a token
							copied out of a logged-in session. Session tokens rotate, and when one
							does your download client stops authenticating and its queue and history
							go empty — the jobs are filed under the old token.
						</span>
					</div>
				</Card>

				<Card title="2. Where the finished release will appear">
					<p className="mb-3 text-gray-300">
						Your zurg or rclone mount root, written exactly as{' '}
						<strong>Radarr sees it</strong> — if *arr runs in Docker, that is the path
						inside its container. DMM has no view of your filesystem; it only names this
						path in history so *arr knows where to import from.
					</p>
					<input
						type="text"
						value={mountRoot}
						onChange={(e) => setMountRoot(e.target.value)}
						placeholder="/mnt/zurg/__all__"
						className="w-full rounded bg-gray-800 px-2 py-2.5 font-mono text-sm text-gray-200"
						spellCheck={false}
					/>
					{viaUsername ? (
						<div className="mt-3 flex gap-2 rounded border-2 border-yellow-500/30 p-3 text-xs text-gray-300">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
							<span>
								That path cannot travel in a URL, so it goes in SABnzbd&apos;s{' '}
								<strong>Username</strong> field instead — the form below already
								accounts for it. Windows paths and any path containing a space take
								this route.
							</span>
						</div>
					) : (
						<p className="mt-2 text-xs text-gray-400">
							Leave it blank if you only want *arr to track progress. Everything still
							works; there is just nothing for it to import.
						</p>
					)}

					<div className="mt-4 rounded border-2 border-gray-600/50 p-3 text-xs text-gray-300">
						<div className="mb-1 font-semibold text-gray-200">
							No mount yet? You need zurg.
						</div>
						<p>
							zurg exposes your Real-Debrid library as a filesystem, which is what
							gives this a path to import from — and what Plex, Jellyfin, Emby and
							Infuse read.
						</p>
						<ul className="ml-4 mt-2 list-disc space-y-1">
							<li>
								<a
									href="https://github.com/debridmediamanager/zurg-public"
									target="_blank"
									rel="noopener noreferrer"
									className="underline decoration-dotted"
								>
									zurg-public
								</a>{' '}
								— the public release, free for anyone. Start here.
							</li>
							<li>
								<a
									href="https://github.com/debridmediamanager/zurg"
									target="_blank"
									rel="noopener noreferrer"
									className="underline decoration-dotted"
								>
									zurg nightly builds
								</a>{' '}
								— the repo is private; access comes with a{' '}
								<a
									href="https://www.patreon.com/debridmediamanager"
									target="_blank"
									rel="noopener noreferrer"
									className="underline decoration-dotted"
								>
									Patreon subscription
								</a>
								.
							</li>
						</ul>
					</div>
				</Card>

				<Card title="3. Paste this into Radarr / Sonarr">
					<p className="mb-3 text-gray-300">
						Settings → Download Clients → <strong>+</strong> → <strong>SABnzbd</strong>.
					</p>
					<div className="rounded bg-gray-900/60 px-3 py-1">
						<Field label="Host" value={host} />
						<Field label="Port" value={port} />
						<Field label="Use SSL" value={useSsl ? 'yes' : 'no'} />
						<Field label="URL Base" value={urlBase} />
						<Field
							label="API Key"
							value={apiKey ? (showKey ? apiKey : '•'.repeat(20)) : ''}
							hint={apiKey ? undefined : 'your Real-Debrid token, from step 1'}
						/>
						<Field
							label="Username"
							value={viaUsername ? mountRoot.trim() : ''}
							hint={viaUsername ? 'carries your mount root' : undefined}
						/>
						<Field label="Password" value="" />
						<Field label="Category" value={category} />
					</div>

					<div className="mt-4 flex flex-wrap items-center gap-3">
						<label className="text-sm text-gray-300">Category</label>
						<select
							value={category}
							onChange={(e) => setCategory(e.target.value)}
							className="rounded bg-gray-800 px-2 py-1.5 text-sm text-gray-200"
						>
							{categories.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</select>
						<span className="text-xs text-gray-500">
							It must be one of these, or *arr&apos;s test fails with &ldquo;Category
							does not exist&rdquo;.
						</span>
					</div>
				</Card>

				<Card title="4. Check it before you save">
					<div className="flex flex-wrap items-center gap-3">
						<button
							type="button"
							onClick={runTest}
							disabled={test.kind === 'running'}
							className="inline-flex items-center gap-2 rounded bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-60"
						>
							{test.kind === 'running' ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : null}
							Test these settings
						</button>
						<span className="text-xs text-gray-500">
							Checks more than Radarr&apos;s own Test does — see below.
						</span>
					</div>

					{test.kind === 'done' ? (
						<div className="mt-4 flex flex-col gap-3">
							<Result
								ok={test.token.ok}
								unknown={!test.token.ok && test.token.unknown}
								title={
									test.token.ok
										? `Real-Debrid accepted the token (${test.token.username})`
										: test.token.message
								}
							>
								{test.token.ok && !test.token.premium ? (
									<span className="text-yellow-400">
										This account is not premium, so grabs will fail until it is.
									</span>
								) : null}
								{!test.token.ok && test.token.unknown ? (
									<>
										This says nothing about your token — the check itself could
										not run. Carry on with the rest; a wrong token will show up
										as failed grabs later.
									</>
								) : null}
								{!test.token.ok && !test.token.unknown ? (
									<>
										Radarr&apos;s own Test cannot catch this — the endpoint only
										rejects an <em>empty</em> key, and the token is not handed
										to Real-Debrid until a release is grabbed. Left wrong, every
										download fails later with nothing to point at.
									</>
								) : null}
							</Result>

							<Result
								ok={test.service.ok}
								title={
									test.service.ok
										? 'The download client answered'
										: test.service.message
								}
							>
								{test.service.ok ? (
									<>
										Imports will be read from{' '}
										<code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-cyan-300">
											{test.service.completeDir || '(no mount root set)'}
										</code>
										. Check that is the path Radarr can actually see.
										<div className="mt-1 text-gray-400">
											Categories offered:{' '}
											{test.service.categories.join(', ') || 'none'}
										</div>
									</>
								) : (
									<>
										&ldquo;SABnzbd API is disabled&rdquo; means the operator has
										not turned this on yet.
									</>
								)}
							</Result>
						</div>
					) : null}
				</Card>

				<Card title="What to expect once it is running">
					<ul className="ml-4 list-disc space-y-2 text-gray-300">
						<li>
							A grab sits in *arr&apos;s queue while the work happens. The bar covers
							two passes: <strong>0–50%</strong> is DMM pulling the release off
							Usenet, <strong>50–100%</strong> is Real-Debrid pulling it from DMM. It
							is not stuck at 50%.
						</li>
						<li>
							Big releases take a while — every byte has to cross DMM before
							Real-Debrid can be handed a torrent. There is no cached shortcut.
						</li>
						<li>
							The release lands in your Real-Debrid account under its own name, which
							is the folder name that shows up in your mount.
						</li>
						<li>
							Removing an item in *arr removes the job here too. You can only touch
							your own — jobs are scoped to the API token that created them.
						</li>
						<li>
							The Usenet bandwidth is the operator&apos;s, not yours. Please do not
							point a large backlog at it.
						</li>
					</ul>
				</Card>
			</div>
		</div>
	);
}
