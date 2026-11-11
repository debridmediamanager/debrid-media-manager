import { EasynewsAccountPanel } from '@/components/EasynewsAccountPanel';
import useLocalStorage from '@/hooks/localStorage';
import type { EasynewsCredentials } from '@/services/easynews';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

/**
 * Login with Easynews alone, for someone with no debrid account. The panel
 * checks the login with Easynews and turns on guest mode, which opens search
 * and DMM Cast for Easynews; once the login is stored, this page sends them home.
 */
export default function EasynewsLoginPage() {
	const router = useRouter();
	const [account] = useLocalStorage<EasynewsCredentials>('en:account');

	useEffect(() => {
		if (account) router.replace('/');
	}, [account, router]);

	return (
		<div className="flex min-h-screen flex-col items-center px-4 pt-[12vh] pb-8">
			<Head>
				<title>Debrid Media Manager - Easynews login</title>
			</Head>
			<div className="sibling-space-y-4 w-full max-w-md p-4">
				<h1 className="text-center text-2xl font-bold">Log in with Easynews</h1>
				<EasynewsAccountPanel />
				<p className="text-center text-sm text-gray-400">
					<Link href="/start" className="underline">
						Back to all logins
					</Link>
				</p>
			</div>
		</div>
	);
}
