import { useRealDebridAccessToken } from '@/hooks/auth';
import { useRouter } from 'next/router';
import { ComponentType, useEffect, useState } from 'react';

const START_ROUTE = '/start';
const LOGIN_ROUTE = '/login';

export const withAuth = <P extends object>(Component: ComponentType<P>) => {
	return function WithAuth(props: P) {
		const router = useRouter();
		const [isLoading, setIsLoading] = useState(true);
		const accessToken = useRealDebridAccessToken();

		useEffect(() => {
			if (
				!accessToken &&
				router.pathname !== START_ROUTE &&
				!router.pathname.endsWith(LOGIN_ROUTE)
			) {
				router.push(START_ROUTE);
			} else {
				setIsLoading(false);
			}
		}, [accessToken, router]);

		if (isLoading) {
			// Render a loading indicator or placeholder on initial load
			return (
				<div className="flex flex-col items-center justify-center min-h-screen">
					<h1 className="text-2xl font-bold">Debrid Media Manager is loading...</h1>
				</div>
			);
		}

		return <Component {...props} />;
	};
};
