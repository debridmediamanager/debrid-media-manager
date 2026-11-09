import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

/**
 * /tv is what DMM Mobile's QR code opens on the member's phone. Like /kodi, a phone that scans
 * it is often not signed in to DMM, and withAuth would send it to /start and lose the code.
 */

const router = { query: { code: 'abcdefgh' }, asPath: '/tv?code=abcdefgh' };
vi.mock('next/router', () => ({ useRouter: () => router }));

const authed = vi.fn();
vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (Component: any) =>
		function Authed(props: any) {
			authed();
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

const LOGIN_ROUTES = new Set(
	Object.keys(
		(import.meta as unknown as { glob: (p: string) => Record<string, unknown> }).glob(
			'/src/pages/*/login.tsx'
		)
	).map((p) => p.replace('/src/pages', '').replace('.tsx', ''))
);

const renderPage = async () => {
	const { default: Page } = await import('@/pages/tv');
	render(
		<Suspense fallback={null}>
			<Page />
		</Suspense>
	);
	await screen.findByLabelText('Code shown on your TV');
};

const reply = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: MockInstance<typeof fetch>;
beforeEach(() => {
	authed.mockClear();
	localStorage.clear();
	fetchMock = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => fetchMock.mockRestore());

describe('/tv?code= on a browser with no DMM sign-in', () => {
	it('keeps the code on the page and offers each sign-in, coming back to it', async () => {
		await renderPage();

		expect(authed).not.toHaveBeenCalled();
		expect(await screen.findByDisplayValue('ABCD-EFGH')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Link TV' })).toBeDisabled();
		expect(screen.getByText(/not signed in to DMM/)).toBeInTheDocument();
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
			expect(new URLSearchParams(query).get('redirect')).toBe('/tv?code=abcdefgh');
		}
		expect(screen.getByText('Remember across devices')).toBeInTheDocument();
	});
});

describe('/tv?code= on a browser signed in to Real-Debrid and AllDebrid', () => {
	beforeEach(() => {
		localStorage.setItem('rd:accessToken', '"rdtoken"');
		localStorage.setItem('ad:apiKey', '"adkey"');
		localStorage.setItem('settings:player', 'android/org.videolan.vlc');
		localStorage.setItem('rd:castToken', '"cast"');
	});

	it('goes through withAuth, ticks both and offers the rest', async () => {
		await renderPage();

		expect(authed).toHaveBeenCalled();
		expect(screen.getByText('✓ Real-Debrid')).toBeInTheDocument();
		expect(screen.getByText('✓ AllDebrid')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: '+ Add Real-Debrid' })).toBeNull();
		expect(screen.getByRole('link', { name: '+ Add TorBox' })).toBeInTheDocument();
		expect(
			screen.getByText(/copies this browser's DMM logins and settings/)
		).toBeInTheDocument();
	});

	it("approves with this browser's synced state and names what the TV got", async () => {
		fetchMock.mockResolvedValue(reply(200, { services: ['rd', 'ad'] }));
		await renderPage();

		fireEvent.click(screen.getByRole('button', { name: 'Link TV' }));

		expect(await screen.findByText('Your TV is linked')).toBeInTheDocument();
		expect(screen.getByText(/Real-Debrid, AllDebrid/)).toBeInTheDocument();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/tv/approve');
		expect(JSON.parse(String(init?.body))).toEqual({
			userCode: 'ABCD-EFGH',
			state: {
				'rd:accessToken': '"rdtoken"',
				'ad:apiKey': '"adkey"',
				'settings:player': 'android/org.videolan.vlc',
			},
			confirmOtherNetwork: false,
		});
	});

	it('links a TV on another connection only once the member says it is theirs', async () => {
		fetchMock
			.mockResolvedValueOnce(
				reply(428, { otherNetwork: true, error: 'This TV is on a different connection.' })
			)
			.mockResolvedValueOnce(reply(200, { services: ['rd'] }));
		await renderPage();

		fireEvent.click(screen.getByRole('button', { name: 'Link TV' }));
		fireEvent.click(await screen.findByRole('button', { name: 'It is my TV, link it' }));

		expect(await screen.findByText('Your TV is linked')).toBeInTheDocument();
		expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).confirmOtherNetwork).toBe(true);
	});

	it('shows why DMM refused the code', async () => {
		fetchMock.mockResolvedValue(reply(404, { error: 'DMM Mobile does not know that code.' }));
		await renderPage();

		fireEvent.click(screen.getByRole('button', { name: 'Link TV' }));

		await waitFor(() =>
			expect(screen.getByText('DMM Mobile does not know that code.')).toBeInTheDocument()
		);
		expect(screen.queryByRole('button', { name: 'It is my TV, link it' })).toBeNull();
	});
});
