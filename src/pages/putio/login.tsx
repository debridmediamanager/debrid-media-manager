import { SavedAccountsPicker } from '@/components/SavedAccountsPicker';
import useLocalStorage from '@/hooks/localStorage';
import {
	DMM_PUTIO_APP_ID,
	PutioError,
	checkPutioDeviceCode,
	getPutioAccountInfo,
	isPutioAuthError,
	isPutioRateLimited,
	putioLinkUrl,
	requestPutioDeviceCode,
} from '@/services/putio';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

/** "Poll every few seconds" and the code's 60-minute life, both from put.io's docs. */
const PUTIO_POLL_MS = 5_000;
const PUTIO_POLL_MAX_MS = 60_000;
const PUTIO_CODE_LIFETIME_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sign in to put.io: the device link (put.io's own approval page, no password
 * ever reaches DMM) or a pasted OAuth token. Both are long-lived, so there is no
 * refresh. The app id is DMM's own unless a self-hosted copy sets its own.
 */
export default function PutioLoginPage() {
	const router = useRouter();
	const [, setAccessToken] = useLocalStorage<string>('pt:accessToken');
	const [inputToken, setInputToken] = useState('');
	const [error, setError] = useState('');
	const [checking, setChecking] = useState(false);
	const [code, setCode] = useState<string | null>(null);
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

	const startDeviceLogin = async () => {
		setError('');
		setChecking(true);
		try {
			const appId = process.env.NEXT_PUBLIC_PUTIO_APP_ID || DMM_PUTIO_APP_ID;
			const { code } = await requestPutioDeviceCode(appId);
			setCode(code);

			// The same code is polled until it yields a token, expires (404) or
			// the code's hour is up. Network errors and 5xx keep polling; a 429
			// doubles the wait, since put.io's reset time is unreadable here.
			let interval = PUTIO_POLL_MS;
			const deadline = Date.now() + PUTIO_CODE_LIFETIME_MS;
			while (!cancelled.current && Date.now() < deadline) {
				await sleep(interval);
				if (cancelled.current) return;
				let token: string | null = null;
				try {
					token = await checkPutioDeviceCode(code);
				} catch (err) {
					if (err instanceof PutioError && err.status === 404) break;
					if (isPutioRateLimited(err))
						interval = Math.min(interval * 2, PUTIO_POLL_MAX_MS);
					continue;
				}
				if (token) {
					setAccessToken(token);
					await finish();
					return;
				}
			}
			if (!cancelled.current) {
				setError('That code expired before it was linked. Get a new one.');
				setCode(null);
				setChecking(false);
			}
		} catch (err) {
			if (cancelled.current) return;
			setError(
				`Could not start put.io sign-in: ${err instanceof Error ? err.message : 'unknown error'}`
			);
			setCode(null);
			setChecking(false);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		setChecking(true);
		const token = inputToken.trim();
		try {
			// An account with no plan still signs in; its card says so and every
			// add answers that it needs a plan.
			await getPutioAccountInfo(token);
			setAccessToken(token);
			await finish();
		} catch (err) {
			setError(
				isPutioAuthError(err)
					? 'put.io rejected that token.'
					: `Could not check that token: ${err instanceof Error ? err.message : 'unknown error'}`
			);
			setChecking(false);
		}
	};

	return (
		<div className="flex min-h-screen flex-col items-center px-4 pt-[12vh] pb-8">
			<Head>
				<title>Debrid Media Manager - put.io Login</title>
			</Head>
			<div className="sibling-space-y-4 w-full max-w-md p-4">
				<h1 className="text-center text-2xl font-bold">Connect put.io</h1>
				{error && <p className="text-center text-red-500">{error}</p>}

				{code ? (
					<div className="sibling-space-y-3 rounded-md border-2 border-[#d946ef] bg-[#d946ef]/20 p-4 text-center">
						<p className="text-sm">Enter this code on put.io to finish:</p>
						<p
							className="font-mono text-3xl font-bold tracking-widest select-all"
							data-testid="pt-user-code"
						>
							{code}
						</p>
						<a
							href={putioLinkUrl(code)}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-block rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
						>
							Open app.put.io/link
						</a>
						<p className="text-xs text-gray-400">
							Waiting for you to link it... this page finishes on its own.
						</p>
					</div>
				) : (
					<>
						<SavedAccountsPicker
							prefix="pt:"
							current={null}
							afterSwitch={() =>
								window.location.assign(
									getSafeRedirectPath(router.query.redirect, '/')
								)
							}
						/>
						<button
							type="button"
							onClick={startDeviceLogin}
							disabled={checking}
							className="w-full rounded border-2 border-[#d946ef] bg-[#d946ef]/30 px-4 py-2 text-fuchsia-100 transition-colors hover:bg-[#d946ef]/50 disabled:opacity-50"
						>
							{checking ? 'Starting...' : 'Sign in with put.io'}
						</button>

						<div className="flex items-center gap-2 text-xs text-gray-400">
							<span className="h-px flex-1 bg-gray-700" />
							or paste an OAuth token
							<span className="h-px flex-1 bg-gray-700" />
						</div>

						<form onSubmit={handleSubmit} className="sibling-space-y-4">
							<div>
								<label htmlFor="putioToken" className="block text-sm font-medium">
									OAuth Token
								</label>
								<input
									type="text"
									id="putioToken"
									value={inputToken}
									onChange={(e) => setInputToken(e.target.value)}
									className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
									placeholder="Enter your put.io OAuth token"
									required
								/>
							</div>
							<div className="sibling-space-y-2 flex flex-col">
								<button
									type="submit"
									disabled={checking}
									className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
								>
									{checking ? 'Checking...' : 'Save OAuth Token'}
								</button>
								<a
									href="https://help.put.io/en/articles/5972538-how-to-get-an-oauth-token-from-put-io"
									target="_blank"
									rel="noopener noreferrer"
									className="rounded bg-green-700 px-4 py-2 text-center text-white hover:bg-green-800"
								>
									How to get a put.io OAuth token
								</a>
							</div>
						</form>
						<p className="text-center text-xs text-gray-400">
							Debrid Media Manager is an integration for put.io; put.io did not make
							it. DMM never asks for your put.io password. Your token stays in this
							browser, which calls put.io directly. It reaches DMM&rsquo;s server only
							with your other logins: when you turn on remembering them across
							devices, or hand them to DMM Mobile or a TV.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
