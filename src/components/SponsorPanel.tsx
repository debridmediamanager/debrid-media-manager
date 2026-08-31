import { useSponsor } from '@/hooks/useSponsor';
import { Heart, LogOut } from 'lucide-react';
import { FC, FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { SponsorBadge } from './SponsorBadge';

const GATEKEEPER_URL = 'https://gatekeeper.debridmediamanager.com';

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
	const { isSponsor, sources, githubUsername, link, disconnect } = useSponsor();
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
					<label htmlFor="dmm-api-key" className="text-center text-xs text-gray-400">
						Already sponsoring? Paste your DMM API key to show your badge and unlock
						sponsor features.
					</label>
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
