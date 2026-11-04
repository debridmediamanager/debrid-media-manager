import { render, screen } from '@testing-library/react';
import React, { Suspense, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reported 2026-11-04 (Reddit, iPhone + AllDebrid): the camera opened the TV's link code in
 * Safari, which held no DMM sign-in, and withAuth sent it to /start - the code and the reason
 * gone. The access log showed that phone bounced /kodi?code= -> /start five times before it
 * signed in; 9 of 15 iPhones that opened /kodi that afternoon were bounced the same way.
 */

const push = vi.fn();
const router = { query: { code: 'ABCDEFGH' }, asPath: '/kodi?code=ABCDEFGH', push, replace: push };
vi.mock('next/router', () => ({ useRouter: () => router }));

// withAuth, as it behaves for a browser with no provider sign-in.
vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (Component: any) =>
		function Redirecting(props: any) {
			push('/start');
			return <Component {...props} />;
		},
}));

vi.mock('next/dynamic', () => ({
	__esModule: true,
	default: (loader: () => Promise<any>) =>
		React.lazy(() => loader().then((component) => ({ default: component }))),
}));
vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, href, ...props }: any) => (
		<a href={String(href)} {...props}>
			{children}
		</a>
	),
}));

vi.mock('@/hooks/castToken', () => ({ useCastToken: () => undefined }));
vi.mock('@/hooks/allDebridCastToken', () => ({ useAllDebridCastToken: () => undefined }));
vi.mock('@/hooks/torboxCastToken', () => ({ useTorBoxCastToken: () => undefined }));
vi.mock('@/hooks/premiumizeCastToken', () => ({ usePremiumizeCastToken: () => undefined }));
vi.mock('@/hooks/offcloudCastToken', () => ({ useOffcloudCastToken: () => undefined }));
vi.mock('@/hooks/debridLinkCastToken', () => ({ useDebridLinkCastToken: () => undefined }));
vi.mock('@/hooks/useSponsor', () => ({
	useSponsor: () => ({ isSponsor: false, apiKey: null, githubUsername: null }),
}));

const LOGIN_ROUTES = new Set(
	Object.keys(
		(import.meta as unknown as { glob: (p: string) => Record<string, unknown> }).glob(
			'/src/pages/*/login.tsx'
		)
	).map((p) => p.replace('/src/pages', '').replace('.tsx', ''))
);

const renderPage = async () => {
	const { default: Page } = await import('@/pages/kodi');
	render(
		<Suspense fallback={null}>
			<Page />
		</Suspense>
	);
	await screen.findByLabelText('Code shown in Kodi');
};

describe('/kodi?code= on a browser with no DMM sign-in', () => {
	beforeEach(() => {
		push.mockClear();
		localStorage.clear();
	});

	it('stays on the page with the code instead of going to /start', async () => {
		await renderPage();

		expect(push).not.toHaveBeenCalled();
		expect(await screen.findByDisplayValue('ABCD-EFGH')).toBeInTheDocument();
	});

	it('offers each sign-in, coming back to this code', async () => {
		await renderPage();

		for (const name of [
			'Real-Debrid',
			'TorBox',
			'AllDebrid',
			'Premiumize',
			'Offcloud',
			'Debrid-Link',
		]) {
			const href = screen.getByRole('link', { name }).getAttribute('href')!;
			const [path, query] = href.split('?');
			expect(LOGIN_ROUTES).toContain(path);
			expect(new URLSearchParams(query).get('redirect')).toBe('/kodi?code=ABCDEFGH');
		}
	});

	it('still goes through withAuth once the browser is signed in', async () => {
		localStorage.setItem('ad:apiKey', 'key');

		await renderPage();

		expect(push).toHaveBeenCalledWith('/start');
	});
});
