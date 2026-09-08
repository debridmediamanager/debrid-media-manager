import { useSponsor } from '@/hooks/useSponsor';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import { Heart, LogOut } from 'lucide-react';
import Link from 'next/link';
import { FC, FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { SponsorBadge } from './SponsorBadge';

/**
 * What a sponsorship actually opens, named on the panel that asks for one.
 *
 * Each of these is reachable and documented without a key, so the links go to
 * the real pages rather than to a paywall: the setup guides read the same for
 * everyone, and only the endpoints behind them check the key.
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
		what: "DMM's torrent library as a Torznab indexer",
	},
	{
		name: 'Ten other streams in Stremio Cast',
		what: 'instead of five, set per profile below',
	},
	{
		name: 'Skip the queue',
		what: 'priority on the NZB uploader and a higher job ceiling on the torrent uploader',
	},
];

const SOURCE_LABELS: Record<string, string> = {
	github: 'GitHub Sponsors',
	patreon: 'Patreon',
	onetime: 'One-time donation',
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
				className="rounded border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-pink-400 focus:outline-none"
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
					<div className="text-xs text-gray-400">
						<p className="mb-2 text-center">A sponsorship opens:</p>
						<ul className="flex list-none flex-col gap-1">
							{PERKS.map(({ href, name, what }) => (
								<li key={name} className="flex flex-col">
									{href ? (
										<Link href={href} className="text-blue-400 hover:underline">
											{name}
										</Link>
									) : (
										<span className="text-gray-300">{name}</span>
									)}
									<span className="text-gray-500">{what}</span>
								</li>
							))}
						</ul>
					</div>
					<label htmlFor="dmm-api-key" className="text-center text-xs text-gray-400">
						Already sponsoring? Paste your DMM API key to show your badge and open them
						here.
					</label>
					{keyForm}
					<p className="text-center text-xs text-gray-500">
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
