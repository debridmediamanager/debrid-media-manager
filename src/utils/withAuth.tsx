/**
 * @deprecated This HOC violates SOLID principles and has mixed concerns.
 * Please use the new auth system:
 * - For new components: import { withAuthMigration } from '@/utils/authMigration'
 * - For direct auth access: import { useAuth } from '@/contexts/AuthContext'
 *
 * Migration guide:
 * 1. Replace: export default withAuth(Component)
 *    With: export default withAuthMigration(Component)
 *
 * 2. For components that don't need auth:
 *    export default withAuthMigration(Component, { requireAuth: false })
 */

import { Logo } from '@/components/Logo';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useRouter } from 'next/router';
import { ComponentType, useEffect, useState } from 'react';
import { disableGuestMode, useGuestMode } from './guestMode';
import { supportsLookbehind } from './lookbehind';

const START_ROUTE = '/start';
const LOGIN_ROUTE = '/login';
const HOME_ROUTE = '/';
const RETURN_URL_KEY = 'dmm_return_url';

export interface WithAuthOptions {
	/**
	 * Whether a guest - a browser that entered without connecting a debrid
	 * service - may open this page. Almost every page says yes: search, browse
	 * and Settings need no provider account, and Settings is where a sponsor
	 * links the DMM API key the indexer endpoints run on. The library says no,
	 * because there is no account whose torrents it could list.
	 */
	allowGuest?: boolean;
}

export const withAuth = <P extends object>(
	Component: ComponentType<P>,
	{ allowGuest = true }: WithAuthOptions = {}
) => {
	return function WithAuth(props: P) {
		const router = useRouter();
		const [isLoading, setIsLoading] = useState(true);
		const [rdKey, rdLoading, rdIsRefreshing] = useRealDebridAccessToken();
		const adKey = useAllDebridApiKey();
		const [tbKey] = useState(() => {
			if (typeof window !== 'undefined') {
				return localStorage.getItem('tb:apiKey');
			}
			return null;
		});
		const [pmKey] = useState(() => {
			if (typeof window !== 'undefined') {
				// Either credential counts as being signed in to Premiumize
				return localStorage.getItem('pm:accessToken') || localStorage.getItem('pm:apiKey');
			}
			return null;
		});

		// Without this an Offcloud-only user bounces to /start on every page,
		// forever - they are signed in, and nothing here would know it.
		const [ocKey] = useState(() => {
			if (typeof window !== 'undefined') {
				return localStorage.getItem('oc:apiKey');
			}
			return null;
		});

		// Either Debrid-Link credential counts as being signed in. Without this
		// a Debrid-Link-only user bounces to /start on every page, forever.
		const [dlKey] = useState(() => {
			if (typeof window !== 'undefined') {
				return localStorage.getItem('dl:accessToken') || localStorage.getItem('dl:apiKey');
			}
			return null;
		});

		const isGuest = useGuestMode();

		// Check for refresh credentials
		const [hasRefreshCredentials] = useState(() => {
			if (typeof window !== 'undefined') {
				const refreshToken = localStorage.getItem('rd:refreshToken');
				const clientId = localStorage.getItem('rd:clientId');
				const clientSecret = localStorage.getItem('rd:clientSecret');
				return !!(refreshToken && clientId && clientSecret);
			}
			return false;
		});

		const hasCredential = !!(rdKey || adKey || tbKey || pmKey || ocKey || dlKey);

		// Signing in ends guest mode. Otherwise the flag outlives the reason it
		// was set and keeps hiding the library from someone who now has an
		// account to fill it.
		useEffect(() => {
			if (isGuest && (hasCredential || hasRefreshCredentials)) {
				disableGuestMode();
			}
		}, [isGuest, hasCredential, hasRefreshCredentials]);

		useEffect(() => {
			// Don't redirect if token is refreshing
			if (rdIsRefreshing) {
				return;
			}

			// A guest on a page that needs a provider account. Home, not /start:
			// /start would offer a login they already declined, and the return
			// URL stored on that path would send them straight back here on the
			// next render - a loop, because guest mode never resolves it.
			if (isGuest && !allowGuest && !hasCredential && !hasRefreshCredentials) {
				router.push(HOME_ROUTE);
				return;
			}

			if (
				!hasCredential &&
				!isGuest &&
				router.pathname !== START_ROUTE &&
				!router.pathname.endsWith(LOGIN_ROUTE) &&
				!rdLoading &&
				!hasRefreshCredentials
			) {
				// Store full URL including query parameters
				localStorage.setItem(RETURN_URL_KEY, router.asPath);
				router.push(START_ROUTE);
			} else {
				const returnUrl = localStorage.getItem(RETURN_URL_KEY);
				if (returnUrl && returnUrl !== START_ROUTE && !returnUrl.endsWith(LOGIN_ROUTE)) {
					localStorage.removeItem(RETURN_URL_KEY);
					router.push(returnUrl);
				}
				setIsLoading(false);
			}
		}, [
			rdKey,
			rdLoading,
			rdIsRefreshing,
			hasCredential,
			hasRefreshCredentials,
			isGuest,
			adKey,
			tbKey,
			pmKey,
			ocKey,
			dlKey,
			router,
		]);

		// Loading screen state tracking
		useEffect(() => {
			// Loading state managed internally
		}, [isLoading]);

		if (isLoading) {
			// Render a loading indicator or placeholder on initial load
			return (
				<div className="flex min-h-screen flex-col items-center justify-center">
					<Logo />
					<h1 className="text-2xl">Debrid Media Manager is loading...</h1>
					{!supportsLookbehind() && (
						<div className="bg-red-900">
							<a href="https://caniuse.com/js-regexp-lookbehind">
								You are using an unsupported browser.
							</a>{' '}
							Update your browser/OS for DMM to work.
						</div>
					)}
				</div>
			);
		}

		return <Component {...props} />;
	};
};
