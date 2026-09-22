import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sponsorMock = vi.fn();
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useSponsor', () => ({
	__esModule: true,
	useSponsor: () => sponsorMock(),
}));

vi.mock('@/components/Logo', () => ({
	__esModule: true,
	Logo: () => <div data-testid="logo" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: { error: toastError, success: vi.fn() },
	Toaster: () => null,
}));

import EmbySetupPage from '@/pages/emby';

const API_KEY = 'a1b2c3' + 'd'.repeat(54) + 'ef12';
const SHA = '9'.repeat(64);

const asSponsor = (apiKey: string | null = API_KEY) =>
	sponsorMock.mockReturnValue({ isSponsor: true, apiKey });
const asVisitor = () => sponsorMock.mockReturnValue({ isSponsor: false, apiKey: null });

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => 'blob:plugin');
const revokeObjectURL = vi.fn();
let clicked: HTMLAnchorElement[] = [];

function respond(status: number, body: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		blob: async () => new Blob([new Uint8Array([0x4d, 0x5a])]),
	};
}

beforeEach(() => {
	sponsorMock.mockReset();
	toastError.mockReset();
	fetchMock.mockReset();
	clicked = [];
	fetchMock.mockImplementation(async (url: string) =>
		url.endsWith('catalog.json')
			? respond(200, [
					{ assembly: 'Emby.Plugin.RdZurg.dll', version: '1.0.3.0', sha256: SHA },
				])
			: respond(200, null)
	);
	vi.stubGlobal('fetch', fetchMock);
	Object.assign(URL, { createObjectURL, revokeObjectURL });
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		clicked.push(this);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the page', () => {
	it('names the six Emby plugins, and no Usenet one', () => {
		asSponsor();
		render(<EmbySetupPage />);
		for (const name of ['RD zurg', 'AD zurg', 'TB zurg', 'PM zurg', 'OC zurg', 'DL zurg']) {
			expect(screen.getByTestId(`plugin-${name}`)).toBeTruthy();
		}
		expect(screen.queryByTestId('plugin-NZB zurg')).toBeNull();
	});

	it('names every account a plugin serves in the introduction', () => {
		asVisitor();
		render(<EmbySetupPage />);
		const intro = screen.getByText(/plugins that add your/).textContent ?? '';
		for (const account of [
			'Real-Debrid',
			'AllDebrid',
			'TorBox',
			'Premiumize',
			'Offcloud',
			'Debrid-Link',
		]) {
			expect(intro).toContain(account);
		}
	});

	it('says which Emby it needs and where the plugins folder is', () => {
		asVisitor();
		render(<EmbySetupPage />);
		expect(screen.getByText('Emby 4.9 or newer')).toBeTruthy();
		expect(screen.getByText('/config/plugins')).toBeTruthy();
		expect(screen.getByText('/var/lib/emby/plugins')).toBeTruthy();
	});

	it('links to the Jellyfin page', () => {
		asVisitor();
		render(<EmbySetupPage />);
		expect(screen.getByText(/Using Jellyfin\?/).closest('a')).toHaveAttribute(
			'href',
			'/jellyfin'
		);
	});

	it('pitches a sponsorship to a visitor, and not to a sponsor', () => {
		asVisitor();
		const { unmount } = render(<EmbySetupPage />);
		expect(screen.getByText('A sponsor feature')).toBeTruthy();
		unmount();

		asSponsor();
		render(<EmbySetupPage />);
		expect(screen.queryByText('A sponsor feature')).toBeNull();
	});

	it('keeps the setup visible to a visitor, with downloads off until a key is linked', () => {
		asVisitor();
		render(<EmbySetupPage />);
		expect(screen.getByText('1. Download the ones you use')).toBeTruthy();
		expect(screen.getByLabelText('Download RD zurg')).toBeDisabled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('never puts the key in a command it offers to copy', () => {
		asSponsor();
		const { container } = render(<EmbySetupPage />);
		for (const pre of container.querySelectorAll('pre')) {
			expect(pre.textContent).not.toContain(API_KEY);
		}
	});
});

describe('the published versions', () => {
	it('shows the version and digest the catalog lists, asking with the key in a header', async () => {
		asSponsor();
		render(<EmbySetupPage />);

		await waitFor(() => expect(screen.getByText('v1.0.3.0')).toBeTruthy());
		expect(screen.getByText(`sha256 ${SHA}`)).toBeTruthy();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/emby-plugins/catalog.json');
		expect(url).not.toContain(API_KEY);
		expect(init.headers).toEqual({ 'x-api-key': API_KEY });
	});
});

describe('a download', () => {
	it('sends the key as a header and saves the file under the name Emby loads', async () => {
		asSponsor();
		render(<EmbySetupPage />);

		await act(async () => {
			fireEvent.click(screen.getByLabelText('Download TB zurg'));
		});

		await waitFor(() => expect(clicked).toHaveLength(1));
		const call = fetchMock.mock.calls.find(([url]) => url.endsWith('.dll'))!;
		expect(call[0]).toBe('/api/emby-plugins/Emby.Plugin.TbZurg.dll');
		expect(call[1].headers).toEqual({ 'x-api-key': API_KEY });
		expect(clicked[0].download).toBe('Emby.Plugin.TbZurg.dll');
		expect(clicked[0].href).toBe('blob:plugin');
		expect(toastError).not.toHaveBeenCalled();
	});

	it('says why a revoked or lapsed key was refused, and saves nothing', async () => {
		asSponsor();
		fetchMock.mockImplementation(async () =>
			respond(401, { error: 'Sponsorship is no longer active' })
		);
		render(<EmbySetupPage />);

		await act(async () => {
			fireEvent.click(screen.getByLabelText('Download RD zurg'));
		});

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith('RD zurg: Sponsorship is no longer active')
		);
		expect(clicked).toHaveLength(0);
	});

	it('says so when a plugin has not been published yet', async () => {
		asSponsor();
		fetchMock.mockImplementation(async () => respond(404, { error: 'No such plugin file' }));
		render(<EmbySetupPage />);

		await act(async () => {
			fireEvent.click(screen.getByLabelText('Download DL zurg'));
		});

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				'DL zurg: That plugin has not been published yet'
			)
		);
	});
});
