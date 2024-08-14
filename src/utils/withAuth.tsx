import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxApiKey } from '@/hooks/auth';
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
		const tbKey = useTorBoxApiKey();

		useEffect(() => {
			if (
				!rdKey &&
				!adKey &&
				!tbKey &&
				router.pathname !== START_ROUTE &&
				!router.pathname.endsWith(LOGIN_ROUTE) &&
				!rdLoading
			) {
				router.push(START_ROUTE);
			} else {
				setIsLoading(rdLoading);
			}
		}, [rdKey, rdLoading, adKey, tbKey, router]);

		if (isLoading) {
			// Render a loading indicator or placeholder on initial load
			return (
				<div className="flex flex-col items-center justify-center min-h-screen">
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
