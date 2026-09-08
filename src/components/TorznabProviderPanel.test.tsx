import { SPONSOR_TOKEN_KEY } from '@/hooks/useSponsor';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => {
	const fn = vi.fn() as ReturnType<typeof vi.fn> & { success: ReturnType<typeof vi.fn> };
	fn.success = vi.fn();
	return fn;
});
vi.mock('react-hot-toast', () => ({ default: toastMock }));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...rest }: any) => (
		<a href={typeof href === 'string' ? href : String(href)} {...rest}>
			{children}
		</a>
	),
}));

import { TorznabProviderPanel } from './TorznabProviderPanel';

const ACTIVE = {
	shortId: 'ZP1M',
	githubUsername: 'someone',
	sources: ['github'],
	keyVersion: 1,
	exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

function asSponsor() {
	const token = `${Buffer.from(JSON.stringify(ACTIVE)).toString('base64url')}.sig`;
	window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(token));
	return token;
}

const fetchMock = vi.fn();

beforeEach(() => {
	window.localStorage.clear();
	toastMock.mockClear();
	toastMock.success.mockClear();
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, json: async () => ({ linked: [] }) });
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('TorznabProviderPanel', () => {
	// Real-Debrid and AllDebrid are answered from DMM's own tables. A form that
	// asked for their keys would imply those feeds need one, which they do not.
	it('asks only for the providers DMM cannot answer for itself', () => {
		render(<TorznabProviderPanel />);

		expect(screen.getByLabelText('TorBox API key')).toBeInTheDocument();
		expect(screen.getByLabelText('Premiumize API key')).toBeInTheDocument();
		expect(screen.getByLabelText('Offcloud API key')).toBeInTheDocument();
		expect(screen.queryByLabelText(/Real-Debrid API key/)).toBeNull();
		expect(screen.queryByLabelText(/AllDebrid API key/)).toBeNull();
		expect(screen.queryByLabelText(/Debrid-Link API key/)).toBeNull();
	});

	it('shows the feed URL each linked key unlocks', () => {
		render(<TorznabProviderPanel />);

		expect(screen.getByText('/api/torznab/tb/cached')).toBeInTheDocument();
		expect(screen.getByText('/api/torznab/pm/cached')).toBeInTheDocument();
		expect(screen.getByText('/api/torznab/oc/cached')).toBeInTheDocument();
	});

	// Visible to everyone, in the shape the rest of Settings uses: the feature
	// is described and the way in is named rather than the panel being absent.
	it('shows a non-sponsor the panel, disabled, with the way in', () => {
		render(<TorznabProviderPanel />);

		expect(screen.getByLabelText('TorBox API key')).toBeDisabled();
		expect(screen.getByRole('link', { name: 'gatekeeper' })).toHaveAttribute(
			'href',
			'https://gatekeeper.debridmediamanager.com'
		);
	});

	it('sends the sponsor token when it links a key', async () => {
		const token = asSponsor();
		render(<TorznabProviderPanel />);

		fireEvent.change(screen.getByLabelText('TorBox API key'), {
			target: { value: 'tb-secret' },
		});
		fireEvent.click(screen.getAllByRole('button', { name: 'Link' })[0]);

		await waitFor(() => {
			const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
			expect(post, 'no link request was sent').toBeTruthy();
			expect(post![1].headers).toMatchObject({ 'x-dmm-sponsor': token });
			expect(JSON.parse(post![1].body)).toEqual({ service: 'tb', apiKey: 'tb-secret' });
		});
	});

	// The server checks the key against the provider before storing it, so the
	// reason it gives is the only thing that tells a typo from a dead account.
	it('shows the server reason for a refused key', async () => {
		asSponsor();
		fetchMock.mockImplementation(async (_url: string, init?: any) =>
			init?.method === 'POST'
				? { ok: false, json: async () => ({ error: 'TorBox rejected that key' }) }
				: { ok: true, json: async () => ({ linked: [] }) }
		);
		render(<TorznabProviderPanel />);

		fireEvent.change(screen.getByLabelText('TorBox API key'), { target: { value: 'nope' } });
		fireEvent.click(screen.getAllByRole('button', { name: 'Link' })[0]);

		expect(await screen.findByText('TorBox rejected that key')).toBeInTheDocument();
	});

	it('shows a linked key masked, with a way to unlink it', async () => {
		asSponsor();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				linked: [
					{
						service: 'pm',
						label: 'Premiumize',
						hint: 'abcd••••••••wxyz',
						updatedAt: '2026-09-09T00:00:00.000Z',
					},
				],
			}),
		});
		render(<TorznabProviderPanel />);

		expect(await screen.findByText('abcd••••••••wxyz')).toBeInTheDocument();
		expect(screen.queryByLabelText('Premiumize API key')).toBeNull();
		expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument();
	});
});
