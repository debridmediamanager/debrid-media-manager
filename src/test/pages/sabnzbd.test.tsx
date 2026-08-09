import SabnzbdSetupPage from '@/pages/sabnzbd';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Route both calls the Test button makes: the token check and get_config. */
function routeFetch(
	token: { status?: number; body: unknown },
	config: { body: unknown } = {
		body: {
			config: {
				misc: { complete_dir: '/mnt/zurg/__all__', categories: ['*', 'movies', 'tv'] },
			},
		},
	}
) {
	return vi.fn().mockImplementation((url: string) =>
		String(url).startsWith('/api/realdebrid/validate-token')
			? Promise.resolve({
					ok: true,
					status: token.status ?? 200,
					json: async () => token.body,
				})
			: Promise.resolve({ ok: true, status: 200, json: async () => config.body })
	);
}

const field = (label: string) => screen.getByTestId(`field-${label}`);

/** The get_config URL the page sent, ignoring the token-check call. */
const sabCall = () =>
	vi
		.mocked(global.fetch)
		.mock.calls.map((c) => String(c[0]))
		.find((url) => url.startsWith('/api/sabnzbd'));

const setMountRoot = (value: string) =>
	fireEvent.change(screen.getByPlaceholderText('/mnt/zurg/__all__'), { target: { value } });

const setApiKey = (value: string) =>
	fireEvent.change(screen.getByPlaceholderText('Paste your Real-Debrid API token'), {
		target: { value },
	});

beforeEach(() => {
	vi.clearAllMocks();
	global.fetch = routeFetch({ body: { valid: true, username: 'ben', premium: true } }) as any;
});

describe('SABnzbd setup page', () => {
	it('builds the URL Base from the mount root', () => {
		render(<SabnzbdSetupPage />);
		expect(within(field('URL Base')).getByText('api/sabnzbd/mnt/zurg/__all__')).toBeTruthy();

		setMountRoot('/data/media/');
		expect(within(field('URL Base')).getByText('api/sabnzbd/data/media')).toBeTruthy();
	});

	// The trap this page exists to head off: nzb2rd reads the URL-Base form off
	// the raw path without decoding it, so these two have to go via Username.
	it.each([
		['a Windows path', 'D:\\zurg'],
		['a path with a space', '/mnt/my mount'],
	])('routes %s to the Username field instead of the URL Base', (_label, value) => {
		render(<SabnzbdSetupPage />);
		setMountRoot(value);

		expect(within(field('URL Base')).getByText('api/sabnzbd')).toBeTruthy();
		expect(within(field('Username')).getByText(value)).toBeTruthy();
		expect(screen.getByText(/cannot travel in a URL/)).toBeTruthy();
	});

	it('leaves Username blank for a plain mount root', () => {
		render(<SabnzbdSetupPage />);
		expect(within(field('Username')).getByText('(leave blank)')).toBeTruthy();
	});

	it('never renders the token until it is revealed', () => {
		render(<SabnzbdSetupPage />);
		setApiKey('SECRETRDTOKEN');

		expect(within(field('API Key')).queryByText('SECRETRDTOKEN')).toBeNull();
		fireEvent.click(screen.getByLabelText('Show token'));
		expect(within(field('API Key')).getByText('SECRETRDTOKEN')).toBeTruthy();
	});

	it('tests with the mount root in the path', async () => {
		render(<SabnzbdSetupPage />);
		setApiKey('RDTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		expect(await screen.findByText('The download client answered')).toBeTruthy();
		expect(sabCall()).toBe('/api/sabnzbd/mnt/zurg/__all__/api?mode=get_config&apikey=RDTOKEN');
	});

	it('tests with ma_username when the mount root cannot ride in the path', async () => {
		global.fetch = routeFetch(
			{ body: { valid: true, username: 'ben', premium: true } },
			{ body: { config: { misc: { complete_dir: 'D:\\zurg', categories: [] } } } }
		) as any;
		render(<SabnzbdSetupPage />);
		setMountRoot('D:\\zurg');
		setApiKey('RDTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		await waitFor(() => expect(sabCall()).toBeTruthy());
		expect(sabCall()).toBe(
			'/api/sabnzbd/api?mode=get_config&apikey=RDTOKEN&ma_username=D%3A%5Czurg'
		);
	});

	it('reports the categories the service actually offers', async () => {
		global.fetch = routeFetch(
			{ body: { valid: true, username: 'ben', premium: true } },
			{ body: { config: { misc: { complete_dir: '/x', categories: ['films', 'series'] } } } }
		) as any;
		render(<SabnzbdSetupPage />);
		setApiKey('RDTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		expect(await screen.findByText(/Categories offered: films, series/)).toBeTruthy();
	});

	// The failure neither *arr's Test nor the endpoint itself can detect.
	it('catches a token Real-Debrid rejects, even though the endpoint accepts it', async () => {
		global.fetch = routeFetch({ body: { valid: false } }) as any;
		render(<SabnzbdSetupPage />);
		setApiKey('WRONGTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		expect(await screen.findByText('Real-Debrid did not accept this token')).toBeTruthy();
		// ...while the download client itself still answers fine.
		expect(screen.getByText('The download client answered')).toBeTruthy();
	});

	it('warns when the account is not premium', async () => {
		global.fetch = routeFetch({
			body: { valid: true, username: 'ben', premium: false },
		}) as any;
		render(<SabnzbdSetupPage />);
		setApiKey('RDTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		expect(await screen.findByText(/not premium/)).toBeTruthy();
	});

	it('names the account the releases will land in', async () => {
		render(<SabnzbdSetupPage />);
		setApiKey('RDTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		expect(await screen.findByText(/Real-Debrid accepted the token \(ben\)/)).toBeTruthy();
	});

	it('surfaces a SABnzbd rejection verbatim', async () => {
		global.fetch = routeFetch(
			{ body: { valid: true, username: 'ben', premium: true } },
			{ body: { status: false, error: 'SABnzbd API is disabled' } }
		) as any;
		render(<SabnzbdSetupPage />);
		setApiKey('RDTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		expect(await screen.findByText('SABnzbd API is disabled')).toBeTruthy();
	});

	it('refuses to test without a token, so no empty call is made', () => {
		render(<SabnzbdSetupPage />);
		fireEvent.click(screen.getByText('Test these settings'));
		expect(global.fetch).not.toHaveBeenCalled();
	});

	// A check that could not run must never be reported as a bad token.
	it('says nothing about the token when the check itself fails', async () => {
		global.fetch = routeFetch({ status: 502, body: { error: 'unreachable' } }) as any;
		render(<SabnzbdSetupPage />);
		setApiKey('RDTOKEN');
		fireEvent.click(screen.getByText('Test these settings'));

		expect(await screen.findByText('Could not check the token right now')).toBeTruthy();
		expect(screen.getByText(/says nothing about your token/)).toBeTruthy();
		expect(screen.queryByText('Real-Debrid did not accept this token')).toBeNull();
	});
	it('points people with no mount at zurg, public build first', () => {
		render(<SabnzbdSetupPage />);

		const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
		expect(href('zurg-public')).toBe('https://github.com/debridmediamanager/zurg-public');
		expect(href('zurg nightly builds')).toBe('https://github.com/debridmediamanager/zurg');
		expect(href('Patreon subscription')).toBe('https://www.patreon.com/debridmediamanager');
		// The nightly repo is private, so say so next to the link rather than
		// letting people click into a 404.
		expect(screen.getByText(/the repo is private/)).toBeTruthy();
	});
});
