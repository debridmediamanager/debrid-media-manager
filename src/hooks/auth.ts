import { getAllDebridUser } from '@/services/allDebrid';
import { getCurrentUser as getRealDebridUser, getToken } from '@/services/realDebrid';
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

export const useRealDebridAccessToken = () => {
	const [clientId] = useLocalStorage<string>('clientId');
	const [clientSecret] = useLocalStorage<string>('clientSecret');
	const [refreshToken] = useLocalStorage<string>('refreshToken');
	const [accessToken, setAccessToken] = useLocalStorage<string>('accessToken');

	useEffect(() => {
		(async () => {
			if (!accessToken && refreshToken && clientId && clientSecret) {
				// Refresh token is available, so try to get new tokens
				const response = await getToken(clientId, clientSecret, refreshToken);
				if (response) {
					// New tokens obtained, save them and return authenticated
					const { access_token, expires_in } = response;
					setAccessToken(access_token, expires_in);
				}
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clientId, clientSecret, refreshToken]);

	return accessToken;
};

export const useAllDebridApiKey = () => {
	const [apiKey] = useLocalStorage<string>('apiKey');
	return apiKey;
};

export const useCurrentUser = () => {
	const [rdUser, setRdUser] = useState<RealDebridUser | null>(null);
	const [adUser, setAdUser] = useState<AllDebridUser | null>(null);
	const router = useRouter();
	const [accessToken] = useLocalStorage<string>('accessToken');
	const [apiKey] = useLocalStorage<string>('apiKey');

	useEffect(() => {
		(async () => {
			if (!accessToken && !apiKey) return null;
			if (accessToken) {
				const rdUserResponse = await getRealDebridUser(accessToken);
				if (rdUserResponse) setRdUser(<RealDebridUser>rdUserResponse);
			}
			if (apiKey) {
				const adUserResponse = await getAllDebridUser(apiKey);
				if (adUserResponse) setAdUser(<AllDebridUser>adUserResponse);
			}
		})();
	}, [accessToken, apiKey, router]);

	return { realDebrid: rdUser, allDebrid: adUser };
};
