import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { getAllDebridUser } from '../services/allDebrid';
import { getCurrentUser as getRealDebridUser, getToken } from '../services/realDebrid';
import { TorBoxUser, getUserData } from '../services/torbox';
import { TraktUser, getTraktUser } from '../services/trakt';
import { clearRdKeys } from '../utils/clearLocalStorage';
import { getSafeRedirectPath } from '../utils/router';
import useLocalStorage from './localStorage';

export interface RealDebridUser {
	id: number;
	username: string;
	email: string;
	points: number;
	locale: string;
	avatar: string;
	type: 'premium' | 'free';
	premium: number;
	expiration: string;
}

export interface AllDebridUser {
	username: string;
	email: string;
	isPremium: boolean;
	isSubscribed: boolean;
	isTrial: boolean;
	premiumUntil: number;
	lang: string;
	preferedDomain: string;
	fidelityPoints: number;
}

const initialRealDebridState = {
	user: null as RealDebridUser | null,
	error: null as Error | null,
	loading: true,
	hasAuth: false,
	isInitialized: false,
	isRefreshing: false,
	subscribers: new Set<() => void>(),
};

// Global singleton state for RealDebrid to prevent duplicate calls
let globalRealDebridState = { ...initialRealDebridState };

// Simplified hook that handles RealDebrid auth
const useRealDebrid = () => {
	const [user, setUser] = useState<RealDebridUser | null>(globalRealDebridState.user);
	const [error, setError] = useState<Error | null>(globalRealDebridState.error);
	const [loading, setLoading] = useState(globalRealDebridState.loading);
	const [isRefreshing, setIsRefreshing] = useState(globalRealDebridState.isRefreshing);
	const [token, setToken] = useLocalStorage<string>('rd:accessToken');
	const [clientId] = useLocalStorage<string>('rd:clientId');
	const [clientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [refreshToken] = useLocalStorage<string>('rd:refreshToken');

	useEffect(() => {
		const updateState = () => {
			setUser(globalRealDebridState.user);
			setError(globalRealDebridState.error);
			setLoading(globalRealDebridState.loading);
			setIsRefreshing(globalRealDebridState.isRefreshing);
		};

		// Subscribe to global state changes
		globalRealDebridState.subscribers.add(updateState);
		return () => {
			globalRealDebridState.subscribers.delete(updateState);
		};
	}, []);

	useEffect(() => {
		let isMounted = true;
		let retryTimeout: ReturnType<typeof setTimeout> | null = null;

		const isAuthError = (e: unknown) => {
			const status = (e as any)?.response?.status;
			return status === 401 || status === 403;
		};

		const auth = async (attempt = 0): Promise<void> => {
			// Prevent duplicate initialization globally, but allow retry if no user yet
			if (globalRealDebridState.isInitialized && globalRealDebridState.user) {
				return;
			}

			if (!refreshToken || !clientId || !clientSecret) {
				globalRealDebridState.loading = false;
				globalRealDebridState.subscribers.forEach((fn) => fn());
				return;
			}

			globalRealDebridState.isInitialized = true;

			try {
				// Try current token first
				if (token) {
					try {
						const user = await getRealDebridUser(token);
						if (isMounted) {
							globalRealDebridState.user = user as RealDebridUser;
							globalRealDebridState.error = null;
							globalRealDebridState.loading = false;
							globalRealDebridState.hasAuth = true;
							globalRealDebridState.subscribers.forEach((fn) => fn());
						}
						return;
					} catch {
						// Token invalid, will refresh
					}
				}

				// Get new token
				globalRealDebridState.isRefreshing = true;
				globalRealDebridState.subscribers.forEach((fn) => fn());

				const { access_token, expires_in } = await getToken(
					clientId,
					clientSecret,
					refreshToken
				);

				if (isMounted) {
					setToken(access_token, expires_in);
					const user = await getRealDebridUser(access_token);
					globalRealDebridState.user = user as RealDebridUser;
					globalRealDebridState.error = null;
					globalRealDebridState.hasAuth = true;
					globalRealDebridState.subscribers.forEach((fn) => fn());
				}
			} catch (e) {
				if (isMounted) {
					console.error('RealDebrid auth error:', e);
					if (isAuthError(e)) {
						clearRdKeys();
					} else if (attempt < 3) {
						// Retry with exponential backoff for transient errors
						const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
						globalRealDebridState.isInitialized = false;
						retryTimeout = setTimeout(() => {
							if (isMounted) {
								auth(attempt + 1);
							}
						}, delay);
						return; // Keep loading/refreshing state active during retry
					}
					globalRealDebridState.error = e as Error;
					globalRealDebridState.user = null;
					globalRealDebridState.hasAuth = false;
					globalRealDebridState.isInitialized = false;
				}
			}

			if (isMounted) {
				globalRealDebridState.loading = false;
				globalRealDebridState.isRefreshing = false;
				globalRealDebridState.subscribers.forEach((fn) => fn());
			}
		};

		auth();

		return () => {
			isMounted = false;
			if (retryTimeout) clearTimeout(retryTimeout);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshToken, clientId, clientSecret]);

	return { user, error, loading, isRefreshing, hasAuth: !!token };
};

export const __resetRealDebridStateForTests = () => {
	globalRealDebridState = {
		...initialRealDebridState,
		subscribers: new Set(),
	};
};

// Separate hooks for other services
const useAllDebrid = () => {
	const [user, setUser] = useState<AllDebridUser | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [loading, setLoading] = useState(false);
	const [token] = useLocalStorage<string>('ad:apiKey');

	useEffect(() => {
		if (!token) {
			return;
		}

		setLoading(true);
		getAllDebridUser(token)
			.then((user) => {
				setUser(user as AllDebridUser);
				setError(null);
				setLoading(false);
			})
			.catch((e) => {
				setError(e as Error);
				setLoading(false);
			});
	}, [token]);

	return { user, error, hasAuth: !!token, loading };
};

const useTorBox = () => {
	const [user, setUser] = useState<TorBoxUser | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [loading, setLoading] = useState(false);
	const [token] = useLocalStorage<string>('tb:apiKey');

	useEffect(() => {
		if (!token) {
			return;
		}

		setLoading(true);
		getUserData(token)
			.then((response) => {
				if (response.success) {
					setUser(response.data);
					setError(null);
				}
				setLoading(false);
			})
			.catch((e) => {
				setError(e as Error);
				setLoading(false);
			});
	}, [token]);

	return { user, error, hasAuth: !!token, loading };
};

const useTrakt = () => {
	const [user, setUser] = useState<TraktUser | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [loading, setLoading] = useState(false);
	const [token] = useLocalStorage<string>('trakt:accessToken');
	const [_, setUserSlug] = useLocalStorage<string>('trakt:userSlug');

	useEffect(() => {
		if (!token) {
			return;
		}

		setLoading(true);
		getTraktUser(token)
			.then((user) => {
				setUser(user);
				setUserSlug(user.user.ids.slug);
				setError(null);
				setLoading(false);
			})
			.catch((e) => {
				setError(e as Error);
				setLoading(false);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [token]);

	return { user, error, hasAuth: !!token, loading };
};

// Backward compatibility hook for withAuth.tsx
export const useRealDebridAccessToken = (): [string | null, boolean, boolean] => {
	const { loading, isRefreshing } = useRealDebrid();
	const [token] = useLocalStorage<string>('rd:accessToken');
	return [token, loading, isRefreshing];
};

export const useAllDebridApiKey = () => {
	const [apiKey] = useLocalStorage<string>('ad:apiKey');
	return apiKey;
};

export const useTorBoxAccessToken = () => {
	const [apiKey] = useLocalStorage<string>('tb:apiKey');
	return apiKey;
};

// Main hook that combines all services
export const useCurrentUser = () => {
	const rd = useRealDebrid();
	const ad = useAllDebrid();
	const tb = useTorBox();
	const trakt = useTrakt();

	return {
		rdUser: rd.user,
		rdError: rd.error,
		hasRDAuth: rd.hasAuth,
		rdIsRefreshing: rd.isRefreshing,
		adUser: ad.user,
		adError: ad.error,
		hasADAuth: ad.hasAuth,
		tbUser: tb.user,
		tbError: tb.error,
		hasTBAuth: tb.hasAuth,
		traktUser: trakt.user,
		traktError: trakt.error,
		hasTraktAuth: trakt.hasAuth,
		isLoading: rd.loading,
	};
};

export const useDebridLogin = () => {
	const router = useRouter();

	const navigateToLogin = (pathname: string) => {
		const redirect = getSafeRedirectPath(router.asPath, '/');
		console.log('[Auth] navigateToLogin', {
			currentPath: router.asPath,
			loginPath: pathname,
			redirect,
		});
		if (redirect && redirect !== pathname) {
			console.log('[Auth] pushing with redirect query', { pathname, redirect });
			router.push({ pathname, query: { redirect } });
			return;
		}

		console.log('[Auth] pushing without redirect query', { pathname });
		router.push({ pathname });
	};

	return {
		loginWithRealDebrid: () => navigateToLogin('/realdebrid/login'),
		loginWithAllDebrid: () => navigateToLogin('/alldebrid/login'),
		loginWithTorbox: () => navigateToLogin('/torbox/login'),
	};
};
