import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/head', () => ({
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import CopyrightAdminPage from '@/pages/copyright/admin';

const notice = {
	id: '3f2c9a1e-7b44-4d2a-9a51-0c1d2e3f4a5b',
	status: 'pending',
	claimantName: 'Claimant',
	claimantEmail: 'claims@example.com',
	representing: null,
	work: 'A film',
	reason: 'Ours.',
	locations: 'magnet:?xt=urn:btih:aaaa',
	hashes: ['a'.repeat(40)],
	releases: [],
	hashlistIds: [],
	submitterIp: null,
	reviewNote: null,
	reviewedAt: null,
	createdAt: '2026-10-24T10:00:00Z',
};

describe('/copyright/admin', () => {
	beforeEach(() => {
		localStorage.setItem('dmm:takedownAdminToken', 'token');
		global.fetch = vi.fn(
			async () => new Response(JSON.stringify({ notices: [notice] }))
		) as any;
	});
	afterEach(() => localStorage.clear());

	it('folds the token form, shortens the id and counts what was parsed', async () => {
		render(<CopyrightAdminPage />);
		expect(await screen.findByText('What was parsed (1 hash)')).toBeInTheDocument();
		expect(screen.getByText('3f2c9a1e')).toHaveAttribute('title', notice.id);
		expect(screen.queryByPlaceholderText('Admin token')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Change token' }));
		expect(screen.getByPlaceholderText('Admin token')).toBeInTheDocument();
	});

	it('keeps the token form while the token is refused', async () => {
		global.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as any;
		render(<CopyrightAdminPage />);
		expect(await screen.findByText('The token was refused.')).toBeInTheDocument();
		expect(screen.getByPlaceholderText('Admin token')).toBeInTheDocument();
	});
});
