import { SPONSOR_TOKEN_KEY, useSponsor } from '@/hooks/useSponsor';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import { enableGuestMode } from '@/utils/guestMode';
import { takeSponsorHandoffKey } from '@/utils/sponsorHandoff';
import { Heart, LogOut } from 'lucide-react';
import Link from 'next/link';
import { FC, FormEvent, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { SponsorBadge } from './SponsorBadge';

/**
 * What a sponsorship actually opens, named on the panel that asks for one.
 *
 * Each of these is reachable and documented without a key, so the links go to
 * the real pages rather than to a paywall: the setup guides read the same for
 * everyone, and only the endpoints behind them check the key.
 *
 * Anything gated on the sponsor token or on `Sponsors.dmmApiKey` belongs in this
 * list. The Jellyfin plugin repository shipped without being added to it, so for
 * a few days the only page that offers a sponsorship left out the newest reason
 * to take one.
 */
const PERKS: { href?: string; name: string; what: string }[] = [
	{
		href: '/newznab',
		name: 'Usenet indexer',
		what: 'DMM as a Newznab indexer in Prowlarr, Sonarr and Radarr',
	},
	{
		href: '/torznab',
		name: 'Torrent indexer',
		what: "DMM's torrent library as a Torznab indexer, with live cache feeds for TorBox, Premiumize and Offcloud",
	},
	{
		href: '/wanted',
		name: 'Wanted list',
		what: 'films and shows your zurg fetches for you, new episodes and upgrades included, filled from here, Kodi, Trakt and MDBList lists or a Radarr or Sonarr backup',
	},
	{
		href: 'https://notes.debridmediamanager.com/dmm/seerr/',
		name: 'Seerr',
		what: 'requests from Overseerr or Jellyseerr land in your Wanted list',
	},
	{
		href: '/jellyfin',
		name: 'Jellyfin plugins',
		what: 'seven plugins: your Real-Debrid, AllDebrid, TorBox, Premiumize, Offcloud, Debrid-Link and Usenet libraries inside Jellyfin, with nothing mounted',
	},
	{
		href: '/emby',
		name: 'Emby plugins',
		what: 'six plugins for the same debrid libraries inside Emby, one file per account',
	},
	{
		name: 'Ten other streams in Stremio Cast',
		what: 'instead of five, set per profile below',
	},
	{
		name: 'Skip the queue',
		what: 'priority and 2 TB of Usenet a day instead of 300 GB on the NZB uploader, and three jobs at once instead of one on the torrent uploader',
	},
	{
		href: 'https://zurg.debridmediamanager.com/',
		name: 'zurg nightly',
		what: 'every provider, the source code, the Docker image and the Android app',
	},
	{
		name: 'zurg with your key',
		what: 'set as dmm_api_key, DMM names every release for rex and Plex and sorts the __magic__ folders',
	},
	{
		href: '/api-docs',
		name: 'Sponsor API',
		what: 'release identification, cached availability, media details and metadata for your own tools',
	},
	{
		href: 'https://notes.debridmediamanager.com/guides/remote-help/',
		name: 'Free remote help',
		what: 'a helper fixes your zurg or rex setup in your own terminal while you watch',
	},
	{
		name: 'Sponsor role on Discord',
		what: 'connect Discord on gatekeeper',
	},
];

/** Set once the perks list has been shown open, so later visits start it closed. */
const PERKS_SEEN_KEY = 'settings:sponsorPerksSeen';

const SOURCE_LABELS: Record<string, string> = {
	github: 'GitHub Sponsors',
	patreon: 'Patreon',
	onetime: 'One-time donation',
	staff: 'Discord staff',
	earned: 'Fulfilling requests',
};

/**
 * Settings panel for redeeming a gatekeeper DMM API key.
 *
 * The key is the one thing every sponsor can obtain, which is why it is the
 * link rather than a third-party login: dmm has no accounts of its own.
 */
export const SponsorPanel: FC = () => {
	const {
		isSponsor,
		sources,
		githubUsername,
		apiKey: storedApiKey,
		link,
		disconnect,
	} = useSponsor();
	const [apiKey, setApiKey] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Closed unless this is a non-sponsor's first visit. Decided in an effect
	// from storage directly: `isSponsor` reads false on the first render for
	// everyone, which would open it for sponsors too.
	const [perksOpen, setPerksOpen] = useState(false);

	useEffect(() => {
		try {
			if (localStorage.getItem(PERKS_SEEN_KEY)) return;
			localStorage.setItem(PERKS_SEEN_KEY, '1');
			if (!localStorage.getItem(SPONSOR_TOKEN_KEY)) setPerksOpen(true);
		} catch {
			// Storage blocked: the list just starts closed.
		}
	}, []);

	// Arrived from gatekeeper's "Open DMM with this key": link it here, so a new
	// browser never has to find and paste the key. Guest mode keeps the site open
	// for a sponsor with no debrid login at all (an NZB-only zurg user).
	useEffect(() => {
		const key = takeSponsorHandoffKey();
		if (!key) return;
		enableGuestMode();
		setBusy(true);
		void link(key).then(({ ok, error: why }) => {
			setBusy(false);
			if (ok) toast.success('Sponsorship linked');
			else setError(why ?? 'Could not verify that key');
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!apiKey.trim() || busy) return;

		setBusy(true);
		setError(null);
		const result = await link(apiKey);
		setBusy(false);

		if (result.ok) {
			setApiKey('');
			toast.success('Sponsorship verified', { icon: '💖' });
		} else {
			setError(result.error ?? 'Could not verify that key');
		}
	};

	const perks = (
		<details
			open={perksOpen}
			onToggle={(e) => setPerksOpen(e.currentTarget.open)}
			className="text-xs text-gray-400"
		>
			<summary className="cursor-pointer text-center text-gray-300">
				What a sponsorship opens ({PERKS.length})
			</summary>
			<ul className="mt-2 flex list-none flex-col gap-1">
				{PERKS.map(({ href, name, what }) => (
					<li key={name} className="flex flex-col">
						{href ? (
							<Link href={href} className="text-blue-400 hover:underline">
								{name}
							</Link>
						) : (
							<span className="text-gray-300">{name}</span>
						)}
						<span className="text-gray-400">{what}</span>
					</li>
				))}
			</ul>
		</details>
	);

	const keyForm = (
		<>
			<input
				id="dmm-api-key"
				type="text"
				value={apiKey}
				onChange={(e) => {
					setApiKey(e.target.value);
					setError(null);
				}}
				placeholder="64-character DMM API key"
				autoComplete="off"
				spellCheck={false}
				className="rounded border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-pink-400 focus:outline-hidden"
			/>
			{error && <p className="text-center text-xs text-red-300">{error}</p>}
			<button
				type="submit"
				disabled={busy || !apiKey.trim()}
				className="rounded bg-pink-600 px-3 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
			>
				{busy ? 'Verifying…' : 'Verify sponsorship'}
			</button>
		</>
	);

	return (
		<div className="rounded border-2 border-pink-500/30 p-4">
			<div className="mb-3 flex items-center justify-center gap-2 text-center text-sm font-medium text-pink-200">
				<Heart className="h-4 w-4 text-pink-400" />
				Sponsorship
			</div>

			{isSponsor ? (
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-center gap-2">
						<SponsorBadge showName />
					</div>
					<p className="text-center text-xs text-gray-400">
						Verified via {sources.map((s) => SOURCE_LABELS[s] ?? s).join(' · ')}
					</p>
					{/*
					 * A browser that linked before the key was worth keeping holds a
					 * token and nothing else, and the indexer pages have no key to
					 * fill in. Asking for it again here is the only way back to one
					 * short of disconnecting a working sponsorship first.
					 */}
					{!storedApiKey && (
						<form onSubmit={submit} className="flex flex-col gap-3">
							<label
								htmlFor="dmm-api-key"
								className="text-center text-xs text-gray-400"
							>
								Paste your DMM API key again to have it filled in for you on the{' '}
								<Link href="/newznab" className="text-blue-400 hover:underline">
									indexer
								</Link>{' '}
								<Link href="/torznab" className="text-blue-400 hover:underline">
									setup
								</Link>{' '}
								pages.
							</label>
							{keyForm}
						</form>
					)}
					{perks}
					<button
						onClick={() => {
							disconnect();
							toast('Sponsorship disconnected from this browser.');
						}}
						className="inline-flex items-center justify-center gap-2 rounded border border-gray-600 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700/50"
					>
						<LogOut className="h-3 w-3" />
						Disconnect
					</button>
				</div>
			) : (
				<form onSubmit={submit} className="flex flex-col gap-3">
					{perks}
					<label htmlFor="dmm-api-key" className="text-center text-xs text-gray-400">
						Already sponsoring? Paste your DMM API key to show your badge and open them
						here.
					</label>
					{keyForm}
					<p className="text-center text-xs text-gray-400">
						Get your key by connecting your GitHub account on{' '}
						<a
							href={GATEKEEPER_URL}
							target="_blank"
							rel="noopener"
							className="text-blue-400 hover:underline"
						>
							gatekeeper
						</a>
						.
					</p>
				</form>
			)}
		</div>
	);
};

export default SponsorPanel;
