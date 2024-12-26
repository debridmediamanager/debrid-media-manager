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

export const useCurrentUser = () => {
	const [rdUser, setRdUser] = useState<RealDebridUser | null>(null);
	const [adUser, setAdUser] = useState<AllDebridUser | null>(null);
	const [tbUser, setTbUser] = useState<TorBoxUser | null>(null);
	const [traktUser, setTraktUser] = useState<TraktUser | null>(null);
	const router = useRouter();
	const [rdToken] = useLocalStorage<string>('rd:accessToken');
	const [adToken] = useLocalStorage<string>('ad:apiKey');
	const [tbToken] = useLocalStorage<string>('tb:apiKey');
	const [traktToken] = useLocalStorage<string>('trakt:accessToken');
	const [_, setTraktUserSlug] = useLocalStorage<string>('trakt:userSlug');
	const [rdError, setRdError] = useState<Error | null>(null);
	const [adError, setAdError] = useState<Error | null>(null);
	const [tbError, setTbError] = useState<Error | null>(null);
	const [traktError, setTraktError] = useState<Error | null>(null);

	const hasRDAuth = !!rdToken;
	const hasADAuth = !!adToken;
	const hasTBAuth = !!tbToken;
	const hasTraktAuth = !!traktToken;

	useEffect(() => {
		(async () => {
			try {
				if (rdToken) {
					const rdUserResponse = await getRealDebridUser(rdToken);
					if (rdUserResponse) setRdUser(rdUserResponse as RealDebridUser);
				}
			} catch (error: any) {
				setRdError(new Error(error));
			}
			try {
				if (adToken) {
					const adUserResponse = await getAllDebridUser(adToken);
					if (adUserResponse) setAdUser(adUserResponse as AllDebridUser);
				}
			} catch (error: any) {
				setAdError(new Error(error));
			}
			try {
				if (tbToken) {
					const tbUserResponse = await getUserData(tbToken);
					if (tbUserResponse && tbUserResponse.success) {
						setTbUser(tbUserResponse.data);
					}
				}
			} catch (error: any) {
				setTbError(new Error(error));
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
				setTraktError(new Error(error));
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdToken, adToken, tbToken, traktToken, router]);

	return {
		rdUser,
		rdError,
		hasRDAuth,
		adUser,
		adError,
		hasADAuth,
		tbUser,
		tbError,
		hasTBAuth,
		traktUser,
		traktError,
		hasTraktAuth,
	};
};

export const useDebridLogin = () => {
	const router = useRouter();

	const loginWithRealDebrid = async () => {
		await router.push('/realdebrid/login');
	};

	const loginWithAllDebrid = async () => {
		await router.push('/alldebrid/login');
	};

	const loginWithTorbox = async () => {
		await router.push('/torbox/login');
	};

	return {
		loginWithRealDebrid,
		loginWithAllDebrid,
		loginWithTorbox,
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

export const useTorBoxAccessToken = () => {
	const [apiKey] = useLocalStorage<string>('tb:apiKey');
	return apiKey;
};
