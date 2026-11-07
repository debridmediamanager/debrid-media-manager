import { postEasynews } from '@/components/EasynewsResults';
import useLocalStorage from '@/hooks/localStorage';
import type { EasynewsCredentials } from '@/services/easynews';
import { getSafeRedirectPath } from '@/utils/router';
import { Cast } from 'lucide-react';
import Link from 'next/link';
import Router from 'next/router';
import { useState } from 'react';

// The visitor's own Easynews login, which the Usenet tab searches with. Easynews
// forbids sharing an account, so DMM has none of its own (see services/easynews).
export const EasynewsAccountPanel = () => {
	const [account, setAccount] = useLocalStorage<EasynewsCredentials>('en:account');
	const [sendToZurg, setSendToZurg] = useLocalStorage<boolean>('en:sendToZurg');
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const signIn = async (e: React.FormEvent) => {
		e.preventDefault();
		const credentials = { username: username.trim(), password };
		setChecking(true);
		setError(null);
		try {
			// Kept only once Easynews has accepted it, so a typo is not saved.
			await postEasynews('/api/easynews/account', credentials);
			setAccount(credentials);
			setPassword('');
			// A page that sent the visitor here to sign in (DMM Cast, Kodi pairing) gets them back.
			// Read off the URL, not useRouter: the panel also renders outside a page.
			const redirect = new URLSearchParams(window.location.search).get('redirect');
			if (redirect) Router.push(getSafeRedirectPath(redirect, '/settings'));
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not check the login');
		} finally {
			setChecking(false);
		}
	};

	return (
		<div className="rounded border-2 border-gray-500/30 p-4">
			<div className="mb-2 text-sm font-semibold text-gray-100">Easynews</div>
			{account ? (
				<>
					<div className="flex items-center justify-between gap-2">
						<span className="text-gray-300">
							Signed in as <span className="font-semibold">{account.username}</span>
						</span>
						<button
							type="button"
							onClick={() => setAccount(null)}
							className="haptic rounded border border-gray-500 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700/50"
						>
							Sign out
						</button>
					</div>
					{/* Off puts Download back as the main button on Easynews rows. */}
					<label className="mt-2 flex items-center gap-2 text-xs text-gray-300">
						<input
							type="checkbox"
							checked={sendToZurg !== false}
							onChange={(e) => setSendToZurg(e.target.checked)}
						/>
						Show Send to zurg on Easynews results
					</label>
					<Link
						href="/stremio-easynews"
						className="haptic mt-2 inline-flex items-center gap-1 rounded border border-blue-500 bg-blue-900/30 px-2 py-1 text-xs text-blue-100 hover:bg-blue-800/50"
					>
						<Cast className="h-3 w-3 text-blue-400" />
						DMM Cast for Easynews
					</Link>
				</>
			) : (
				<form onSubmit={signIn} className="flex flex-col gap-2">
					<p className="text-xs text-gray-400">
						Sign in with your own Easynews account to search it on the Usenet tab of
						movies and shows. Your login is kept in this browser only, until you set up
						DMM Cast for Easynews: its server then keeps it to play your casts in
						Stremio.
					</p>
					<input
						aria-label="Easynews username"
						placeholder="Username"
						autoComplete="username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						className="w-full rounded bg-gray-800 px-2 py-2 text-gray-200"
					/>
					<input
						aria-label="Easynews password"
						placeholder="Password"
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="w-full rounded bg-gray-800 px-2 py-2 text-gray-200"
					/>
					{error && <p className="text-xs text-red-300">{error}</p>}
					<button
						type="submit"
						disabled={!username.trim() || !password || checking}
						className="haptic rounded border border-gray-500 px-2 py-1.5 text-gray-100 hover:bg-gray-700/50 disabled:opacity-60"
					>
						{checking ? 'Checking…' : 'Sign in'}
					</button>
				</form>
			)}
		</div>
	);
};

export default EasynewsAccountPanel;
