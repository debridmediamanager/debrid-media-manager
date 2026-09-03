import CanaryLinks from '@/components/CanaryLinks';
import FloatingLibraryIndicator from '@/components/FloatingLibraryIndicator';
import { ModalProvider } from '@/components/modals/ModalContext';
import { LibraryCacheProvider } from '@/contexts/LibraryCacheContext';
import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

type AppWithProvidersProps = AppProps & {
	Component: AppProps['Component'] & {
		disableLibraryProvider?: boolean;
	};
};

export default function App({ Component, pageProps }: AppWithProvidersProps) {
	const router = useRouter();

	useEffect(() => {
		// Save scroll position before route changes
		const handleRouteChangeStart = (url: string) => {
			sessionStorage.setItem(`scrollPos_${router.asPath}`, window.scrollY.toString());
		};

		// Restore scroll position after route changes
		const handleRouteChangeComplete = (url: string) => {
			const savedPosition = sessionStorage.getItem(`scrollPos_${url}`);
			if (savedPosition) {
				const targetScroll = parseInt(savedPosition);

				// Try multiple times with increasing delays to handle async content
				const attempts = [100, 300, 600, 1000];
				attempts.forEach((delay) => {
					setTimeout(() => {
						// Only scroll if we haven't reached the target position yet
						if (Math.abs(window.scrollY - targetScroll) > 50) {
							window.scrollTo(0, targetScroll);
						}
					}, delay);
				});
			}
		};

		router.events.on('routeChangeStart', handleRouteChangeStart);
		router.events.on('routeChangeComplete', handleRouteChangeComplete);

		// Restore on initial load (browser back/forward)
		const savedPosition = sessionStorage.getItem(`scrollPos_${router.asPath}`);
		if (savedPosition) {
			const targetScroll = parseInt(savedPosition);

			// Try multiple times with increasing delays to handle async content
			const attempts = [100, 300, 600, 1000];
			attempts.forEach((delay) => {
				setTimeout(() => {
					// Only scroll if we haven't reached the target position yet
					if (Math.abs(window.scrollY - targetScroll) > 50) {
						window.scrollTo(0, targetScroll);
					}
				}, delay);
			});
		}

		return () => {
			router.events.off('routeChangeStart', handleRouteChangeStart);
			router.events.off('routeChangeComplete', handleRouteChangeComplete);
		};
	}, [router]);
	const authRoutes = [
		'/start',
		'/realdebrid/login',
		'/alldebrid/login',
		'/torbox/login',
		'/premiumize/login',
		'/offcloud/login',
		'/debridlink/login',
	];
	const disableLibraryProvider =
		authRoutes.includes(router.pathname) || Component.disableLibraryProvider === true;
	const shouldWrapWithLibraryProvider = !disableLibraryProvider;

	const AppContent = (
		<>
			<Head>
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
				/>
				<meta name="theme-color" content="#1a1a1a" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
			</Head>
			<Component {...pageProps} />
			{shouldWrapWithLibraryProvider && <FloatingLibraryIndicator />}
			<CanaryLinks />
		</>
	);

	return (
		<ModalProvider>
			{shouldWrapWithLibraryProvider ? (
				<LibraryCacheProvider>{AppContent}</LibraryCacheProvider>
			) : (
				AppContent
			)}
		</ModalProvider>
	);
}
