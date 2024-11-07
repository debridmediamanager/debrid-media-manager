import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useRouter } from 'next/router';
import { ComponentType, useEffect, useState } from 'react';
import { supportsLookbehind } from './lookbehind';

const START_ROUTE = '/start';
const LOGIN_ROUTE = '/login';

export const withAuth = <P extends object>(Component: ComponentType<P>) => {
	return function WithAuth(props: P) {
		const router = useRouter();
		const [isLoading, setIsLoading] = useState(true);
		const [rdKey, rdLoading] = useRealDebridAccessToken();
		const adKey = useAllDebridApiKey();

		useEffect(() => {
			if (
				!rdKey &&
				!adKey &&
				router.pathname !== START_ROUTE &&
				!router.pathname.endsWith(LOGIN_ROUTE) &&
				!rdLoading
			) {
				router.push(START_ROUTE);
			} else {
				setIsLoading(rdLoading);
			}
		}, [rdKey, rdLoading, adKey, router]);

		if (isLoading) {
			// Render a loading indicator or placeholder on initial load
			return (
				<div className="flex min-h-screen flex-col items-center justify-center">
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
