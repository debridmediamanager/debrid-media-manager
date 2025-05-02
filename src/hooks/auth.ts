import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
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
	const [isRefreshing, setIsRefreshing] = useState(false);

	useEffect(() => {
		const auth = async () => {
			console.log('[RD AUTH] Starting auth check', {
				hasToken: !!token,
				hasRefreshToken: !!refreshToken,
				hasClientId: !!clientId,
				hasClientSecret: !!clientSecret,
				loading,
				isRefreshing,
			});

			if (!refreshToken || !clientId || !clientSecret) {
				console.log('[RD AUTH] Missing credentials, skipping auth');
				setLoading(false);
				return;
			}

			try {
				// Try current token first
				if (token) {
					try {
						console.log('[RD AUTH] Have token, checking if valid');
						const user = await getRealDebridUser(token);
						console.log('[RD AUTH] Token is valid, user fetched successfully');
						setUser(user as RealDebridUser);
						setError(null);
						setLoading(false);
						return;
					} catch (e) {
						console.log('[RD AUTH] Token invalid or expired, will refresh', e);
					} // Token invalid, continue to refresh
				} else {
					console.log('[RD AUTH] No token found, will get a new one');
				}

				// Get new token
				console.log('[RD AUTH] Refreshing token');
				setIsRefreshing(true);
				const { access_token, expires_in } = await getToken(
					clientId,
					clientSecret,
					refreshToken
				);
				console.log('[RD AUTH] Got new token, expires in', expires_in);
				setToken(access_token, expires_in);
				console.log('[RD AUTH] Fetching user with new token');
				const user = await getRealDebridUser(access_token);
				console.log('[RD AUTH] User fetched successfully with new token');
				setUser(user as RealDebridUser);
				setError(null);
				setIsRefreshing(false);
			} catch (e) {
				console.log('[RD AUTH] Error refreshing token, clearing keys', e);
				clearRdKeys();
				setError(e as Error);
				setIsRefreshing(false);
			} finally {
				setLoading(false);
			}
		};

		auth();
	}, [token, refreshToken, clientId, clientSecret]);

	return { user, error, loading, isRefreshing, hasAuth: !!token };
};

// Separate hooks for other services
const useAllDebrid = () => {
	const [user, setUser] = useState<AllDebridUser | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [token] = useLocalStorage<string>('ad:apiKey');

	useEffect(() => {
		if (!token) return;

		getAllDebridUser(token)
			.then((user) => setUser(user as AllDebridUser))
			.catch((e) => setError(e as Error));
	}, [token]);

	return { user, error, hasAuth: !!token };
};

const useTorBox = () => {
	const [user, setUser] = useState<TorBoxUser | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [token] = useLocalStorage<string>('tb:apiKey');

	useEffect(() => {
		if (!token) return;

		getUserData(token)
			.then((response) => response.success && setUser(response.data))
			.catch((e) => setError(e as Error));
	}, [token]);

	return { user, error, hasAuth: !!token };
};

const useTrakt = () => {
	const [user, setUser] = useState<TraktUser | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [token] = useLocalStorage<string>('trakt:accessToken');
	const [_, setUserSlug] = useLocalStorage<string>('trakt:userSlug');

	useEffect(() => {
		if (!token) return;

		getTraktUser(token)
			.then((user) => {
				setUser(user);
				setUserSlug(user.user.ids.slug);
			})
			.catch((e) => setError(e as Error));
	}, [token]);

	return { user, error, hasAuth: !!token };
};

// Backward compatibility hook for withAuth.tsx
export const useRealDebridAccessToken = (): [string | null, boolean, boolean] => {
	const { user, loading, isRefreshing } = useRealDebrid();
	const [token] = useLocalStorage<string>('rd:accessToken');
	console.log('[RD ACCESS TOKEN HOOK]', { token, loading, isRefreshing });
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

	return {
		loginWithRealDebrid: () => router.push('/realdebrid/login'),
		loginWithAllDebrid: () => router.push('/alldebrid/login'),
		loginWithTorbox: () => router.push('/torbox/login'),
	};
};
