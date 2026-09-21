import useLocalStorage from '@/hooks/localStorage';
import { exchangeSimklCode } from '@/services/simkl';
import { simklRedirectUri, takeSimklLoginContext } from '@/utils/simklLogin';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

/**
 * Where Simkl sends the user back after consent.
 *
 * The path is fixed by the client registration (`<origin>/auth/simkl`), so this
 * file's location is part of the OAuth configuration rather than a free choice.
 *
 * The code is exchanged straight from the browser. The registered client is a
 * public one with no secret, so there is nothing here that a server would hold
 * that this page does not - which is why, unlike the Trakt callback, there is no
 * `/api/.../exchange` behind it.
 */
export default function SimklCallbackPage() {
	const router = useRouter();
	const [, setAccessToken] = useLocalStorage<string>('simkl:accessToken');
	const [, setRefreshToken] = useLocalStorage<string>('simkl:refreshToken');
	const [, setTokenExpiry] = useLocalStorage<number>('simkl:tokenExpiry');
	const [errorMessage, setErrorMessage] = useState('');
	// One authorization code is redeemable exactly once. Without this, a second
	// render of the same query would spend it again and land on invalid_grant.
	const exchanged = useRef(false);

	useEffect(() => {
		if (!router.isReady || exchanged.current) return;

		const { code, state, error, error_description: description } = router.query;

		// The user declined, or Simkl refused before a code existed.
		if (typeof error === 'string') {
			exchanged.current = true;
			setErrorMessage(typeof description === 'string' ? `${error}: ${description}` : error);
			return;
		}
		if (typeof code !== 'string') return;

		exchanged.current = true;
		const context = takeSimklLoginContext();
		if (!context) {
			setErrorMessage(
				'This sign-in did not start here. Please try again from the home page.'
			);
			return;
		}
		if (context.state !== state) {
			setErrorMessage('Sign-in state did not match. Please try again from the home page.');
			return;
		}

		exchangeSimklCode({
			code,
			codeVerifier: context.codeVerifier,
			redirectUri: simklRedirectUri(window.location.origin),
		})
			.then((tokens) => {
				setAccessToken(tokens.access_token, tokens.expires_in);
				if (tokens.refresh_token) setRefreshToken(tokens.refresh_token);
				if (typeof tokens.expires_in === 'number') {
					setTokenExpiry(Date.now() + tokens.expires_in * 1000);
				}
				router.push('/');
			})
			.catch((e) => setErrorMessage(String(e instanceof Error ? e.message : e)));
		// The localStorage setters are new identities on every render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.isReady, router.query]);

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4 text-center text-gray-100">
			<Head>
				<title>Debrid Media Manager - Connecting Simkl</title>
			</Head>
			{errorMessage ? (
				<>
					<p className="text-red-300">Simkl sign-in failed</p>
					<p className="mt-2 max-w-md text-sm text-red-200/80">{errorMessage}</p>
					<button
						type="button"
						onClick={() => router.push('/')}
						className="haptic-sm mt-4 rounded border-2 border-cyan-500 bg-cyan-900/30 px-3 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
					>
						Go Home
					</button>
				</>
			) : (
				<p className="text-sm text-gray-300">Connecting your Simkl account&hellip;</p>
			)}
		</div>
	);
}
