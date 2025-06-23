import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { getAllDebridUser } from '../services/allDebrid';
import { getCurrentUser as getRealDebridUser, getToken } from '../services/realDebrid';
import { TorBoxUser, getUserData } from '../services/torbox';
import { TraktUser, getTraktUser } from '../services/trakt';
import { clearRdKeys } from '../utils/clearLocalStorage';
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

// Simplified hook that handles RealDebrid auth
const useRealDebrid = () => {
	const [user, setUser] = useState<RealDebridUser | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [loading, setLoading] = useState(true);
	const [token, setToken] = useLocalStorage<string>('rd:accessToken');
	const [clientId] = useLocalStorage<string>('rd:clientId');
	const [clientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [refreshToken] = useLocalStorage<string>('rd:refreshToken');
	const hasInitializedRef = useRef(false);

	useEffect(() => {
		let isMounted = true;

		const auth = async () => {
			// Prevent duplicate initialization
			if (hasInitializedRef.current) {
				return;
			}

			if (!refreshToken || !clientId || !clientSecret) {
				setLoading(false);
				return;
			}

			hasInitializedRef.current = true;

			try {
				// Try current token first
				if (token) {
					try {
						const user = await getRealDebridUser(token);
						if (isMounted) {
							setUser(user as RealDebridUser);
							setError(null);
							setLoading(false);
						}
						return;
					} catch {
						// Token invalid, continue to refresh
					}
				}

				// Get new token
				const { access_token, expires_in } = await getToken(
					clientId,
					clientSecret,
					refreshToken
				);

				if (isMounted) {
					setToken(access_token, expires_in);
					const user = await getRealDebridUser(access_token);
					setUser(user as RealDebridUser);
					setError(null);
				}
			} catch (e) {
				if (isMounted) {
					clearRdKeys();
					setError(e as Error);
					// Reset initialization flag on error to allow retry
					hasInitializedRef.current = false;
				}
			} finally {
				if (isMounted) {
					setLoading(false);
				}
			}
		};

		auth();

		return () => {
			isMounted = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshToken, clientId, clientSecret]);

	return { user, error, loading, isRefreshing: false, hasAuth: !!token };
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
	const { user, loading } = useRealDebrid();
	const [token] = useLocalStorage<string>('rd:accessToken');
	return [token, loading, false];
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

	return {
		loginWithRealDebrid: () => router.push('/realdebrid/login'),
		loginWithAllDebrid: () => router.push('/alldebrid/login'),
		loginWithTorbox: () => router.push('/torbox/login'),
	};
};
