import useLocalStorage from '@/hooks/localStorage';
import { checkPinOnce, getAllDebridUser, getPin } from '@/services/allDebrid';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

// AllDebrid allows 12 requests per second and 600 per minute, and documents the
// PIN as a five second poll.
const PIN_POLL_INTERVAL_MS = 5000;

interface ActivePin {
	pin: string;
	check: string;
	user_url: string;
	expires_in: number;
}

export default function AllDebridLoginPage() {
	const router = useRouter();
	const [, setApiKey] = useLocalStorage<string>('ad:apiKey');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');
	const [checking, setChecking] = useState(false);
	const [pin, setPin] = useState<ActivePin | null>(null);
	const [isCopied, setIsCopied] = useState(false);
	const cancelled = useRef(false);

	useEffect(
		() => () => {
			cancelled.current = true;
		},
		[]
	);

	const finish = useCallback(
		async () => router.replace(getSafeRedirectPath(router.query.redirect, '/')),
		[router]
	);

	/**
	 * PIN login. Started by a click rather than on mount, because this page also
	 * takes a pasted key: a PIN nobody is going to approve is a request, a poll
	 * loop and a code on screen spent for nothing.
	 */
	const startPinLogin = async () => {
		setError('');
		setChecking(true);
		try {
			const pinResponse = await getPin();
			setPin(pinResponse);

			try {
				await navigator.clipboard.writeText(pinResponse.pin);
				setIsCopied(true);
			} catch {
				// Blocked outside a user gesture in some browsers - the PIN is on
				// screen either way, so this is not worth surfacing.
			}

			// AllDebrid keeps answering `activated: false` while a PIN ages out
			// rather than erroring, so the deadline is what ends this loop.
			const deadline = Date.now() + pinResponse.expires_in * 1000;
			while (!cancelled.current && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, PIN_POLL_INTERVAL_MS));
				if (cancelled.current) return;
				const check = await checkPinOnce(pinResponse.pin, pinResponse.check);
				if (check.activated && check.apikey) {
					// The PIN flow hands back an ordinary API key - the same
					// credential the form below takes - so it lands in the same
					// place, and nothing downstream can tell the two apart.
					setApiKey(check.apikey);
					await finish();
					return;
				}
			}
			if (!cancelled.current) {
				setError('That PIN expired before it was approved. Try again.');
				setPin(null);
				setChecking(false);
			}
		} catch (err: any) {
			if (cancelled.current) return;
			setError(`Could not sign in: ${err?.message || 'unknown error'}`);
			setPin(null);
			setChecking(false);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		setChecking(true);
		try {
			await getAllDebridUser(inputApiKey.trim());
			setApiKey(inputApiKey.trim());
			await finish();
		} catch (err: any) {
			const code = err?.code;
			setError(
				code === 'AUTH_BAD_APIKEY' || code === 'AUTH_MISSING_APIKEY'
					? 'AllDebrid rejected that key.'
					: `Could not validate API key: ${err?.message || 'unknown error'}`
			);
			setChecking(false);
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - AllDebrid Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect AllDebrid</h1>
				{error && <p className="text-center text-red-500">{error}</p>}

				{pin ? (
					<div className="space-y-3 rounded-md border-2 border-[#aa0000] bg-[#aa0000]/20 p-4 text-center">
						<p className="text-sm">Enter this PIN on AllDebrid to finish:</p>
						<p
							className="select-all font-mono text-3xl font-bold tracking-widest"
							data-testid="ad-pin-code"
						>
							{pin.pin}
						</p>
						<a
							href={pin.user_url}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-block rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
						>
							Open {pin.user_url.replace(/^https?:\/\//, '').split('/')[0]}
						</a>
						<p className="text-xs text-gray-400">
							{isCopied && 'Copied to your clipboard. '}Waiting for you to approve...
							this page finishes on its own.
						</p>
					</div>
				) : (
					<>
						<button
							type="button"
							onClick={startPinLogin}
							disabled={checking}
							className="w-full rounded border-2 border-[#aa0000] bg-[#aa0000]/30 px-4 py-2 text-red-100 transition-colors hover:bg-[#aa0000]/50 disabled:opacity-50"
						>
							{checking ? 'Starting...' : 'Sign in with AllDebrid'}
						</button>
						<p className="text-center text-xs text-gray-400">
							The PIN only fetches your API key for you - both paths end with the same
							key, kept in this browser.
						</p>

						<div className="flex items-center gap-2 text-xs text-gray-500">
							<span className="h-px flex-1 bg-gray-700" />
							or paste an API key
							<span className="h-px flex-1 bg-gray-700" />
						</div>

						<form onSubmit={handleSubmit} className="space-y-4">
							<div>
								<label htmlFor="apiKey" className="block text-sm font-medium">
									API Key
								</label>
								<input
									type="text"
									id="apiKey"
									value={inputApiKey}
									onChange={(e) => setInputApiKey(e.target.value)}
									className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
									placeholder="Enter your AllDebrid API key"
									required
								/>
							</div>
							<div className="flex flex-col space-y-2">
								<button
									type="submit"
									disabled={checking}
									className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
								>
									{checking ? 'Checking...' : 'Save API Key'}
								</button>
								<button
									type="button"
									onClick={() =>
										window.open('https://alldebrid.com/apikeys', '_blank')
									}
									className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
								>
									Get API Key from AllDebrid
								</button>
							</div>
						</form>
					</>
				)}
			</div>
		</div>
	);
}
