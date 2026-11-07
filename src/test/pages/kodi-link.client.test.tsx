import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const rdCast = { id: undefined as string | undefined };
vi.mock('@/hooks/castToken', () => ({ useCastToken: () => rdCast.id }));
vi.mock('@/hooks/allDebridCastToken', () => ({ useAllDebridCastToken: () => undefined }));
vi.mock('@/hooks/torboxCastToken', () => ({ useTorBoxCastToken: () => undefined }));
vi.mock('@/hooks/premiumizeCastToken', () => ({ usePremiumizeCastToken: () => undefined }));
vi.mock('@/hooks/offcloudCastToken', () => ({ useOffcloudCastToken: () => undefined }));
vi.mock('@/hooks/debridLinkCastToken', () => ({ useDebridLinkCastToken: () => undefined }));
const enCast = { id: undefined as string | undefined };
vi.mock('@/hooks/easynewsCastToken', () => ({ useEasynewsCastToken: () => enCast.id }));
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
		rdCast.id = undefined;
		enCast.id = undefined;
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
			const href = screen.getByRole('link', { name: `+ Add ${name}` }).getAttribute('href')!;
			const [path, query] = href.split('?');
			expect(LOGIN_ROUTES).toContain(path);
			expect(new URLSearchParams(query).get('redirect')).toBe('/kodi?code=ABCDEFGH');
		}
		// Easynews has no login page: Settings is behind withAuth, so its form opens here.
		expect(screen.queryByRole('link', { name: '+ Add Easynews' })).toBeNull();
		expect(screen.queryByLabelText('Easynews username')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: '+ Add Easynews' }));
		expect(screen.getByLabelText('Easynews username')).toBeInTheDocument();
	});

	/**
	 * Found on the zen rig, 2026-11-07: "+ Add Easynews" first went to /settings?redirect=, which
	 * withAuth sends to /start on a phone with no debrid sign-in, and the Kodi code was gone.
	 */
	it('signs in to Easynews on the page itself, keeping the code', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		await renderPage();

		fireEvent.click(screen.getByRole('button', { name: '+ Add Easynews' }));
		fireEvent.change(screen.getByLabelText('Easynews username'), { target: { value: 'u' } });
		fireEvent.change(screen.getByLabelText('Easynews password'), { target: { value: 'p' } });
		fireEvent.submit(screen.getByLabelText('Easynews password').closest('form')!);

		await waitFor(() => expect(localStorage.getItem('en:account')).toContain('"u"'));
		expect(fetchMock.mock.calls[0][0]).toBe('/api/easynews/account');
		expect(push).not.toHaveBeenCalled();
		expect(screen.getByDisplayValue('ABCD-EFGH')).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByLabelText('Easynews username')).toBeNull());
		fetchMock.mockRestore();
	});

	it('says one sign-in brings back the rest when Remember across devices is on elsewhere', async () => {
		await renderPage();

		expect(screen.getByText('Remember across devices')).toBeInTheDocument();
	});

	it('still goes through withAuth once the browser is signed in', async () => {
		localStorage.setItem('ad:apiKey', 'key');

		await renderPage();

		expect(push).toHaveBeenCalledWith('/start');
	});
});

/**
 * Reported 2026-11-05 (r/Addons4Kodi): signed in with Real-Debrid on the phone, Kodi got only
 * RD, and once one service was signed in the page offered no way to sign in to another.
 */
describe('/kodi?code= on a browser signed in to one service', () => {
	beforeEach(() => {
		push.mockClear();
		localStorage.clear();
		localStorage.setItem('rd:accessToken', 'token');
		rdCast.id = 'rd-cast';
		enCast.id = undefined;
	});

	it('ticks the signed-in service and offers the others, coming back to this code', async () => {
		await renderPage();

		expect(screen.getByText('✓ Real-Debrid')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: '+ Add Real-Debrid' })).toBeNull();
		expect(screen.getByRole('button', { name: '+ Add Easynews' })).toBeInTheDocument();
		for (const name of ['TorBox', 'AllDebrid', 'Premiumize', 'Offcloud', 'Debrid-Link']) {
			const href = screen.getByRole('link', { name: `+ Add ${name}` }).getAttribute('href')!;
			expect(new URLSearchParams(href.split('?')[1]).get('redirect')).toBe(
				'/kodi?code=ABCDEFGH'
			);
		}
		// A browser already signed in never restores again, so the hint would mislead here.
		expect(screen.queryByText('Remember across devices')).toBeNull();
	});
});

/**
 * Reported 2026-11-05 (Reddit, self-hosted DMM): signed in with Real-Debrid on the member's own
 * server, whose DMM Cast setup failed. The page said the browser was not signed in to DMM and,
 * since it was, offered no Real-Debrid sign-in either: nothing on screen was true or actionable.
 */
describe('/kodi on a browser signed in whose DMM Cast setup has not answered', () => {
	beforeEach(() => {
		push.mockClear();
		localStorage.clear();
		localStorage.setItem('rd:accessToken', 'token');
		rdCast.id = undefined;
		enCast.id = undefined;
	});

	it('says DMM Cast is the missing piece, not the sign-in', async () => {
		await renderPage();

		expect(screen.queryByText(/not signed in to DMM/)).toBeNull();
		expect(screen.getByText(/Setting up DMM Cast for your sign-in/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Link Kodi' })).toBeDisabled();
	});

	it('tells a self-hosted DMM to point the addon at it', async () => {
		await renderPage();

		expect(screen.getByText(window.location.origin)).toBeInTheDocument();
	});
});

/**
 * An Easynews login alone is no sign-in to withAuth, which would send the browser to /start and
 * lose the code. The page enrols it in DMM Cast for Easynews, and Kodi plays through that.
 */
describe('/kodi?code= on a browser signed in to Easynews alone', () => {
	beforeEach(() => {
		push.mockClear();
		localStorage.clear();
		localStorage.setItem('en:account', JSON.stringify({ username: 'u', password: 'p' }));
		rdCast.id = undefined;
		enCast.id = 'enCast12345a';
	});

	it('stays on the page, ticks Easynews and can link', async () => {
		await renderPage();

		expect(push).not.toHaveBeenCalled();
		expect(screen.getByText('✓ Easynews')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: '+ Add Easynews' })).toBeNull();
		expect(screen.getByRole('link', { name: '+ Add Real-Debrid' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Link Kodi' })).toBeEnabled();
	});

	it('says DMM Cast is the missing piece while the Easynews enrolment has not answered', async () => {
		enCast.id = undefined;

		await renderPage();

		expect(screen.getByText(/Setting up DMM Cast for your sign-in/)).toBeInTheDocument();
	});
});
