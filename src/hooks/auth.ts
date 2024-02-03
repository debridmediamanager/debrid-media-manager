import { getAllDebridUser } from '@/services/allDebrid';
import { getCurrentUser as getRealDebridUser, getToken } from '@/services/realDebrid';
import { TraktUser, getTraktUser } from '@/services/trakt';
import { clearRdKeys } from '@/utils/clearLocalStorage';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import useLocalStorage from './localStorage';

interface RealDebridUser {
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

interface AllDebridUser {
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

export const useDebridLogin = () => {
	const router = useRouter();

	const loginWithRealDebrid = async () => {
		await router.push('/realdebrid/login');
	};

	const loginWithAllDebrid = async () => {
		await router.push('/alldebrid/login');
	};

	return {
		loginWithRealDebrid,
		loginWithAllDebrid,
	};
};

export const useRealDebridAccessToken = (): [string | null, boolean] => {
	const [clientId] = useLocalStorage<string>('rd:clientId');
	const [clientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [refreshToken] = useLocalStorage<string>('rd:refreshToken');
	const [accessToken, setAccessToken] = useLocalStorage<string>('rd:accessToken');
	const [loading, setLoading] = useState<boolean>(true);

	useEffect(() => {
		(async () => {
			if (!accessToken && refreshToken && clientId && clientSecret) {
				try {
					// Refresh token is available, so try to get new tokens
					const response = await getToken(clientId, clientSecret, refreshToken);
					if (response) {
						// New tokens obtained, save them and return authenticated
						const { access_token, expires_in } = response;
						setAccessToken(access_token, expires_in);
					} else {
						throw new Error('Unable to get proper response');
					}
				} catch (error) {
					clearRdKeys();
				}
			}
			setLoading(false);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clientId, clientSecret, refreshToken]);

	return [accessToken, loading];
};

export const useAllDebridApiKey = () => {
	const [apiKey] = useLocalStorage<string>('ad:apiKey');
	return apiKey;
};

function removeToken(service: string) {
	window.localStorage.removeItem(`${service}:accessToken`);
	window.location.reload();
}

export const useCurrentUser = () => {
	const [rdUser, setRdUser] = useState<RealDebridUser | null>(null);
	const [adUser, setAdUser] = useState<AllDebridUser | null>(null);
	const [traktUser, setTraktUser] = useState<TraktUser | null>(null);
	const router = useRouter();
	const [rdToken] = useLocalStorage<string>('rd:accessToken');
	const [adToken] = useLocalStorage<string>('ad:apiKey');
	const [traktToken] = useLocalStorage<string>('trakt:accessToken');
	const [_, setTraktUserSlug] = useLocalStorage<string>('trakt:userSlug');
	const [rdError, setRdError] = useState<Error | null>(null);
	const [adError, setAdError] = useState<Error | null>(null);
	const [traktError, setTraktError] = useState<Error | null>(null);

	useEffect(() => {
		(async () => {
			if (!rdToken && !adToken) return null;
			try {
				if (rdToken) {
					const rdUserResponse = await getRealDebridUser(rdToken);
					if (rdUserResponse) setRdUser(<RealDebridUser>rdUserResponse);
				}
			} catch (error: any) {
				if (error.response.status === 401) {
					removeToken('rd');
				} else {
					setRdError(new Error(error));
				}
			}
			try {
				if (adToken) {
					const adUserResponse = await getAllDebridUser(adToken);
					if (adUserResponse) setAdUser(<AllDebridUser>adUserResponse);
				}
			} catch (error: any) {
				if (error.response.status === 401) {
					removeToken('ad');
				} else {
					setAdError(new Error(error));
				}
			}
			try {
				if (traktToken) {
					const traktUserResponse = await getTraktUser(traktToken);
					if (traktUserResponse) {
						setTraktUser(traktUserResponse);
						setTraktUserSlug(traktUserResponse.user.ids.slug);
					}
				}
			} catch (error: any) {
				if (error.response?.status === 401) {
					removeToken('trakt');
				} else {
					setTraktError(new Error(error));
				}
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdToken, adToken, traktToken, router]);

	return { rdUser, rdError, adUser, adError, traktUser, traktError };
};
