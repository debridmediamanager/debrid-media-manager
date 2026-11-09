import { BackToDashboard, Card, SupportLine } from '@/components/IndexerSetup';
import { SIGN_IN_KEYS } from '@/utils/browserStateKeys';
import { collectState } from '@/utils/browserStateSync';
import { withAuth } from '@/utils/withAuth';
import { CheckCircle2, Tv } from 'lucide-react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';

// The page DMM Mobile's QR code opens when it signs in on a TV. Linking hands the TV this
// browser's logins and settings, the ones Remember across devices carries, so nothing is
// typed with a remote. Modelled on /kodi's link card.

/** What someone typed or the QR carried, shown the way the TV shows it: ABCD-EFGH. */
const formatCode = (raw: string) => {
	const code = raw
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 8);
	return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
};

// Text colour on each service's identity colour, as in the UI conventions.
const SERVICES = [
	{ key: 'rd', name: 'Real-Debrid', chip: 'bg-[#b5d496] text-black', login: '/realdebrid/login' },
	{ key: 'tb', name: 'TorBox', chip: 'bg-[#4f46e5] text-white', login: '/torbox/login' },
	{ key: 'ad', name: 'AllDebrid', chip: 'bg-[#fbc730] text-black', login: '/alldebrid/login' },
	{ key: 'pm', name: 'Premiumize', chip: 'bg-[#aa0000] text-white', login: '/premiumize/login' },
	{ key: 'oc', name: 'Offcloud', chip: 'bg-[#f97316] text-black', login: '/offcloud/login' },
	{ key: 'dl', name: 'Debrid-Link', chip: 'bg-[#38bdf8] text-black', login: '/debridlink/login' },
] as const;

/** Signed in to any debrid service when `service` is omitted, to that one otherwise. */
const signedIn = (service?: string) => {
	try {
		return SIGN_IN_KEYS.some(
			(key) => (!service || key.startsWith(`${service}:`)) && !!localStorage.getItem(key)
		);
	} catch {
		return false;
	}
};

/** Signed-in services as solid chips, the others as sign-ins that come back to `redirect`. */
function ServiceChips({ redirect }: { redirect: string }) {
	return (
		<div className="flex flex-wrap gap-2">
			{SERVICES.map(({ key, name, chip, login }) =>
				signedIn(key) ? (
					<span key={key} className={`rounded px-2 py-1 text-sm font-semibold ${chip}`}>
						✓ {name}
					</span>
				) : (
					<Link
						key={key}
						href={`${login}?redirect=${encodeURIComponent(redirect)}`}
						className="rounded border border-dashed border-gray-500 px-2 py-1 text-sm text-gray-300 hover:border-gray-300 hover:text-gray-100"
					>
						+ Add {name}
					</Link>
				)
			)}
		</div>
	);
}

function LinkCard() {
	const router = useRouter();
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [linked, setLinked] = useState<string[] | null>(null);
	// Set when DMM saw this browser on another connection than the TV: one more press links it.
	const [otherNetwork, setOtherNetwork] = useState(false);

	useEffect(() => {
		if (typeof router.query.code === 'string') setCode(formatCode(router.query.code));
	}, [router.query.code]);

	const canLink = signedIn();

	async function submit(event: FormEvent, confirmOtherNetwork = false) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const res = await fetch('/api/tv/approve', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					userCode: code,
					state: collectState(),
					confirmOtherNetwork,
				}),
			});
			const data = await res.json();
			setOtherNetwork(!!data.otherNetwork);
			if (!res.ok) {
				setError(data.error ?? 'Could not link your TV');
				return;
			}
			setLinked(
				data.services.map(
					(service: string) => SERVICES.find((s) => s.key === service)?.name ?? service
				)
			);
		} catch {
			setError('Could not reach DMM. Check your connection and try again.');
		} finally {
			setBusy(false);
		}
	}

	if (linked) {
		return (
			<Card title="Your TV is linked">
				<p className="flex items-start gap-2 text-gray-200">
					<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
					<span>
						DMM Mobile on your TV signs in within a few seconds: {linked.join(', ')},
						and this browser&apos;s settings. You can close this page.
					</span>
				</p>
			</Card>
		);
	}

	return (
		<Card title="Link DMM Mobile on your TV">
			<p className="mb-3 text-gray-300">
				Scan the QR code DMM Mobile shows on your TV with this phone, or enter the code it
				shows here.
			</p>
			<form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
				<label className="sr-only" htmlFor="tv-code">
					Code shown on your TV
				</label>
				<input
					id="tv-code"
					value={code}
					onChange={(e) => {
						setCode(formatCode(e.target.value));
						setOtherNetwork(false);
					}}
					placeholder="ABCD-EFGH"
					autoComplete="off"
					autoCapitalize="characters"
					spellCheck={false}
					maxLength={9}
					className="min-w-0 flex-1 rounded border-2 border-gray-500 bg-gray-900 px-3 py-2 font-mono text-lg tracking-widest text-gray-100 uppercase placeholder:text-gray-600"
				/>
				<button
					type="submit"
					disabled={busy || !canLink || code.replace(/[\s-]/g, '').length !== 8}
					className="haptic rounded border-2 border-green-500 bg-green-900/30 px-4 py-2 text-green-100 transition-colors hover:bg-green-800/50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? 'Linking…' : 'Link TV'}
				</button>
			</form>
			{error && <p className="mt-3 text-red-400">{error}</p>}
			{otherNetwork && (
				<button
					type="button"
					onClick={(e) => submit(e, true)}
					disabled={busy}
					className="haptic mt-3 rounded border-2 border-yellow-500 bg-yellow-900/30 px-4 py-2 text-yellow-100 transition-colors hover:bg-yellow-800/50 disabled:opacity-50"
				>
					It is my TV, link it
				</button>
			)}

			<div className="mt-4 text-gray-300">
				<p className="mb-2">
					{canLink
						? 'Your TV gets the ticked services. Add another and you come straight back here:'
						: 'This browser is not signed in to DMM. Sign in with the service your TV should use and you come straight back here:'}
				</p>
				<ServiceChips redirect={router.asPath} />
				<p className="mt-3 text-sm text-gray-400">
					Linking copies this browser&apos;s DMM logins and settings to the TV: your
					debrid services, and Trakt, Easynews and your DMM API key if you use them here.
					Anyone using that TV can use them, so link only your own.
				</p>
				{!canLink && (
					<>
						{/* Only a browser's first login restores, so this helps on this screen alone. */}
						<p className="mt-3 text-sm text-gray-400">
							Turned on <strong>Remember across devices</strong> in another browser?
							Sign in to any one of those services here and the rest come back with
							it.
						</p>
						<p className="mt-3 text-sm text-gray-400">
							Or open {window.location.host}/tv on a phone or computer where you
							already use DMM and enter the code there.
						</p>
					</>
				)}
			</div>
		</Card>
	);
}

function TvPage() {
	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - DMM Mobile on your TV</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>

			<div className="flex w-full max-w-3xl flex-col gap-5 pb-16">
				<BackToDashboard />
				<header>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
						<Tv className="h-6 w-6 text-gray-400" />
						DMM Mobile on your TV
					</h1>
					<p className="mt-2 text-sm text-gray-400">
						Sign the TV in with the debrid services you already use here, without typing
						a key with the remote.
					</p>
				</header>

				<LinkCard />
				<SupportLine forum="dmm-support" />
			</div>
		</div>
	);
}

const AuthedTvPage = withAuth(TvPage);

// As on /kodi: a phone that scans the TV's code is often not signed in to DMM, and withAuth
// would send it to /start and lose the code, so such a browser gets the page itself.
function TvEntry() {
	return signedIn() ? <AuthedTvPage /> : <TvPage />;
}

export default dynamic(() => Promise.resolve(TvEntry), { ssr: false });
