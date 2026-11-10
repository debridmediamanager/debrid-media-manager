import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Logo', () => ({
	__esModule: true,
	Logo: () => <div data-testid="logo" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import NewznabAdminPage from '@/pages/newznab/admin';

const indexer = (over: Record<string, unknown> = {}) => ({
	prefix: 'tm',
	name: 'Treasure Maps',
	url: 'https://treasure-maps.com/api',
	keyHint: '…970',
	keyless: false,
	enabled: true,
	position: 0,
	pacing: null,
	grabLimit: { rateLimit: 200, windowSeconds: 86400 },
	...over,
});

function serve(body: unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
	);
}

beforeEach(() => localStorage.setItem('dmm:newznabAdminToken', 'token'));
afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('/newznab/admin', () => {
	// The add form has no limits yet; it crashed the page on 2026-11-11 when that
	// null limit was read for its window.
	it('renders the env list and an empty add form', async () => {
		serve({ source: 'environment', indexers: [indexer()] });
		render(<NewznabAdminPage />);
		await screen.findByText(/No indexers are saved here yet/);
		expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
		expect(screen.getAllByRole('combobox').map((s) => (s as HTMLSelectElement).value)).toEqual([
			'3600',
			'3600',
		]);
	});

	it('shows saved rows as forms with the key only as a hint, and keeps an odd window', async () => {
		serve({
			source: 'database',
			indexers: [indexer({ pacing: { rateLimit: 6, windowSeconds: 90 } })],
		});
		render(<NewznabAdminPage />);
		await screen.findByText('prefix tm');
		expect(screen.getByPlaceholderText('Saved (…970); type to replace')).toBeTruthy();
		const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
		await waitFor(() => expect(selects[0].value).toBe('90'));
		expect(selects[1].value).toBe('86400');
		expect(screen.queryByText(/No indexers are saved here yet/)).toBeNull();
	});
});
