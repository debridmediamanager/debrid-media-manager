import { exchangeSimklCode } from '@/services/simkl';
import {
	notifySimklSessionChange,
	simklRedirectUri,
	takeSimklLoginContext,
} from '@/utils/simklLogin';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

/**
 * Where Simkl sends the user back after consent.
 *
 * The path is fixed by the client registration (`<origin>/auth/simkl`), so this
 * file's location is part of the OAuth configuration rather than a free choice.
 *
 * The same-origin backend exchanges the code and holds the provider grant.
 * This page receives only a cookie-backed session, never provider tokens.
 */
export default function SimklCallbackPage() {
	const router = useRouter();
	const [errorMessage, setErrorMessage] = useState('');
	// One authorization code is redeemable exactly once. Without this, a second
	// render of the same query would spend it again and land on invalid_grant.
	const exchanged = useRef(false);

	useEffect(() => {
		if (!router.isReady || exchanged.current) return;

		const { code, state, iss, error, error_description: description } = router.query;
		exchanged.current = true;
		const context = takeSimklLoginContext();
		if (typeof code !== 'string' && typeof error !== 'string') {
			setErrorMessage('No authorization code was returned. Please try signing in again.');
			return;
		}
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
		// Next's query parser has already URL-decoded the issuer. RFC 9207
		// requires an exact match on both approval and denial callbacks.
		if (iss !== 'https://simkl.com') {
			setErrorMessage(
				'Authorization response did not come from Simkl. Please try signing in again.'
			);
			return;
		}
		if (typeof error === 'string') {
			setErrorMessage(typeof description === 'string' ? `${error}: ${description}` : error);
			return;
		}
		if (typeof code !== 'string') {
			setErrorMessage('No authorization code was returned. Please try signing in again.');
			return;
		}

		exchangeSimklCode({
			code,
			codeVerifier: context.codeVerifier,
			redirectUri: simklRedirectUri(window.location.origin),
		})
			.then(() => {
				notifySimklSessionChange();
				router.push('/');
			})
			.catch((e) => setErrorMessage(String(e instanceof Error ? e.message : e)));
	}, [router, router.isReady, router.query]);

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
