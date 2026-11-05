import { BackToDashboard, Card, Field, SupportLine } from '@/components/IndexerSetup';
import { useAllDebridCastToken } from '@/hooks/allDebridCastToken';
import { useCastToken } from '@/hooks/castToken';
import { useDebridLinkCastToken } from '@/hooks/debridLinkCastToken';
import { useOffcloudCastToken } from '@/hooks/offcloudCastToken';
import { usePremiumizeCastToken } from '@/hooks/premiumizeCastToken';
import { useTorBoxCastToken } from '@/hooks/torboxCastToken';
import { useSponsor } from '@/hooks/useSponsor';
import { toasterPosition } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import { CheckCircle2, Tv } from 'lucide-react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

// The Kodi addon's two halves on the web: where to install it from, and the page
// its "Link this Kodi" QR code opens. Linking hands the Kodi this browser's DMM
// Cast addons and, for a sponsor, the DMM API key, so nothing is typed on a TV.

const PRODUCTION_ORIGIN = 'https://debridmediamanager.com';

// Text colour on each service's identity colour, as in the UI conventions.
/** What someone typed or the QR carried, shown the way Kodi shows it: ABCD-EFGH. */
const formatCode = (raw: string) => {
	const code = raw
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 8);
	return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
};

const SERVICES = [
	{ key: 'rd', name: 'Real-Debrid', chip: 'bg-[#b5d496] text-black', login: '/realdebrid/login' },
	{ key: 'tb', name: 'TorBox', chip: 'bg-[#4f46e5] text-white', login: '/torbox/login' },
	{ key: 'ad', name: 'AllDebrid', chip: 'bg-[#fbc730] text-black', login: '/alldebrid/login' },
	{ key: 'pm', name: 'Premiumize', chip: 'bg-[#aa0000] text-white', login: '/premiumize/login' },
	{ key: 'oc', name: 'Offcloud', chip: 'bg-[#f97316] text-black', login: '/offcloud/login' },
	{ key: 'dl', name: 'Debrid-Link', chip: 'bg-[#38bdf8] text-black', login: '/debridlink/login' },
] as const;

/** What withAuth counts as a provider sign-in (src/utils/withAuth.tsx). */
const SIGN_IN_KEYS = [
	'rd:accessToken',
	'rd:refreshToken',
	'ad:apiKey',
	'tb:apiKey',
	'pm:accessToken',
	'pm:apiKey',
	'oc:apiKey',
	'dl:accessToken',
	'dl:apiKey',
];

/** Signed in to every service when `service` is omitted, to that one otherwise. */
const signedIn = (service?: string) => {
	try {
		return SIGN_IN_KEYS.some(
			(key) => (!service || key.startsWith(`${service}:`)) && !!localStorage.getItem(key)
		);
	} catch {
		return false;
	}
};

/**
 * Every service: the ones Kodi gets as solid chips, the others as sign-ins that come back
 * to `redirect`. Without it, a browser signed in to one service had no way to add a second.
 */
function ServiceChips({ casts, redirect }: { casts: Record<string, string>; redirect: string }) {
	return (
		<div className="flex flex-wrap gap-2">
			{SERVICES.map(({ key, name, chip, login }) =>
				casts[key] ? (
					<span key={key} className={`rounded px-2 py-1 text-sm font-semibold ${chip}`}>
						✓ {name}
					</span>
				) : signedIn(key) ? null : (
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

function useCastIds(): Record<string, string> {
	// Opening this page enrols each signed-in service in DMM Cast, as its own cast
	// page does: Kodi plays through those addons.
	const ids: Record<string, string | null | undefined> = {
		rd: useCastToken(),
		tb: useTorBoxCastToken(),
		ad: useAllDebridCastToken({ enroll: true }),
		pm: usePremiumizeCastToken({ enroll: true }),
		oc: useOffcloudCastToken({ enroll: true }),
		dl: useDebridLinkCastToken({ enroll: true }),
	};
	return Object.fromEntries(Object.entries(ids).filter(([, id]) => !!id)) as Record<
		string,
		string
	>;
}

function LinkCard() {
	const router = useRouter();
	const casts = useCastIds();
	const { isSponsor, apiKey, githubUsername } = useSponsor();
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [linked, setLinked] = useState<string[] | null>(null);
	// Set when DMM saw this browser on another connection than the Kodi: one more press links it.
	const [otherNetwork, setOtherNetwork] = useState(false);

	useEffect(() => {
		if (typeof router.query.code === 'string') setCode(formatCode(router.query.code));
	}, [router.query.code]);

	const sponsorKey = isSponsor ? apiKey : null;
	const nothingToLink = !Object.keys(casts).length && !sponsorKey;

	async function submit(event: FormEvent, confirmOtherNetwork = false) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const res = await fetch('/api/kodi/approve', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					userCode: code,
					casts,
					apiKey: sponsorKey ?? undefined,
					confirmOtherNetwork,
				}),
			});
			const data = await res.json();
			setOtherNetwork(!!data.otherNetwork);
			if (!res.ok) {
				setError(data.error ?? 'Could not link Kodi');
				return;
			}
			setLinked([
				...data.accounts.map((a: { name: string }) => a.name),
				...(data.sponsor ? ['your sponsorship'] : []),
			]);
		} catch {
			setError('Could not reach DMM. Check your connection and try again.');
		} finally {
			setBusy(false);
		}
	}

	if (linked) {
		return (
			<Card title="Kodi is linked">
				<p className="flex items-start gap-2 text-gray-200">
					<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
					<span>
						Your Kodi picks this up within a few seconds: {linked.join(', ')}. You can
						close this page.
					</span>
				</p>
				<p className="mt-4 mb-2 text-sm text-gray-400">
					To add another service, sign in to it here, then choose Account → Link again in
					Kodi:
				</p>
				<ServiceChips casts={casts} redirect="/kodi" />
			</Card>
		);
	}

	return (
		<Card title="Link this Kodi">
			<p className="mb-3 text-gray-300">
				In the addon, choose <strong>Link this Kodi</strong> and enter the code it shows, or
				scan its QR code with this phone.
			</p>
			<form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
				<label className="sr-only" htmlFor="kodi-code">
					Code shown in Kodi
				</label>
				<input
					id="kodi-code"
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
					disabled={busy || nothingToLink || code.replace(/[\s-]/g, '').length !== 8}
					className="haptic rounded border-2 border-green-500 bg-green-900/30 px-4 py-2 text-green-100 transition-colors hover:bg-green-800/50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? 'Linking…' : 'Link Kodi'}
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
					It is my Kodi, link it
				</button>
			)}

			<div className="mt-4 text-gray-300">
				<p className="mb-2">
					{nothingToLink
						? 'This browser is not signed in to DMM. Sign in with the service Kodi should play through and you come straight back here:'
						: 'Kodi gets the ticked services. Add another and you come straight back here:'}
				</p>
				<ServiceChips casts={casts} redirect={router.asPath} />
				{sponsorKey && (
					<p className="mt-2 text-sm text-gray-300">
						Sponsor{githubUsername ? ` (${githubUsername})` : ''}: Kodi also gets your
						Wanted list.
					</p>
				)}
				{nothingToLink && (
					<>
						{/* Only a browser's first login restores, so this helps on this screen alone. */}
						<p className="mt-3 text-sm text-gray-400">
							Turned on <strong>Remember across devices</strong> in another browser?
							Sign in to any one of those services here and the rest come back with
							it.
						</p>
						<p className="mt-3 text-sm text-gray-400">
							Or open debridmediamanager.com/kodi on a phone or computer where you
							already use DMM and enter the code there.
						</p>
					</>
				)}
			</div>
		</Card>
	);
}

function KodiPage() {
	// A self-hosted instance installs from its own address.
	const [origin, setOrigin] = useState(PRODUCTION_ORIGIN);
	useEffect(() => setOrigin(window.location.origin), []);

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Kodi</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Toaster position={toasterPosition()} />

			<div className="flex w-full max-w-3xl flex-col gap-5 pb-16">
				<BackToDashboard />
				<header>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
						<Tv className="h-6 w-6 text-gray-400" />
						Watch in Kodi
					</h1>
					<p className="mt-2 text-sm text-gray-400">
						Browse and search films and shows in Kodi, and play the cached releases DMM
						knows of and what members have cast, through your own debrid account.
					</p>
				</header>

				<LinkCard />

				<Card title="Install the addon">
					<ol className="list-decimal space-y-2 pl-5 text-gray-300">
						<li>
							Settings → File manager → <strong>Add source</strong>, and enter this
							address:
							<div className="mt-1 rounded bg-gray-900/60 px-3 py-1">
								<Field label="Source" value={`${origin}/repo/`} />
							</div>
						</li>
						<li>
							Settings → Add-ons → <strong>Install from zip file</strong> → that
							source → <code>repository.dmm</code>. Allow unknown sources if Kodi
							asks.
						</li>
						<li>
							<strong>Install from repository</strong> → DMM → Video add-ons →{' '}
							<strong>Debrid Media Manager</strong>. Updates arrive by themselves from
							then on.
						</li>
					</ol>
				</Card>
				<SupportLine forum="dmm-support" />
			</div>
		</div>
	);
}

const AuthedKodiPage = withAuth(KodiPage);

// A phone that scans the TV's code is often not signed in to DMM (another browser, or Safari
// clearing storage after 7 idle days). withAuth would send it to /start and lose the code, so
// such a browser gets the page itself, which says how to sign in and come back.
function KodiEntry() {
	return signedIn() ? <AuthedKodiPage /> : <KodiPage />;
}

export default dynamic(() => Promise.resolve(KodiEntry), { ssr: false });
