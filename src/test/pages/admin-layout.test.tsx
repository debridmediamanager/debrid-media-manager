import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/admin/newznab' }) }));
vi.mock('next/head', () => ({
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AdminLayout } from '@/components/admin/AdminLayout';
import AdminPage from '@/pages/admin';

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('/admin', () => {
	it('lists every admin page without asking for a token', () => {
		render(<AdminPage />);
		expect(screen.queryByPlaceholderText('Admin token')).toBeNull();
		const links = screen.getAllByRole('link', { name: 'Copyright notices' });
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/admin/copyright',
			'/admin/copyright',
		]);
	});
});

describe('AdminLayout', () => {
	it('asks for a token before rendering a gated page', () => {
		const page = vi.fn(() => <p>inside</p>);
		render(<AdminLayout title="T">{page}</AdminLayout>);
		expect(screen.getByPlaceholderText('Admin token')).toBeInTheDocument();
		expect(page).not.toHaveBeenCalled();
	});

	it('sends the token the old copyright page saved, and marks the current page', async () => {
		localStorage.setItem('dmm:takedownAdminToken', 'old-token');
		const fetchMock = vi.fn(async () => new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);
		render(
			<AdminLayout title="T">
				{(adminFetch) => (
					<button onClick={() => void adminFetch('/api/x', { method: 'POST' })}>
						go
					</button>
				)}
			</AdminLayout>
		);
		fireEvent.click(await screen.findByRole('button', { name: 'go' }));
		await screen.findByRole('button', { name: 'Change token' });
		expect(fetchMock).toHaveBeenCalledWith('/api/x', {
			method: 'POST',
			headers: { Authorization: 'Bearer old-token' },
		});
		expect(screen.getByRole('link', { name: 'Newznab indexers' }).className).toContain(
			'bg-gray-200'
		);
	});

	it('reopens the token form when a call is refused, and saves a new token', async () => {
		localStorage.setItem('dmm:adminToken', 'bad');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 401 }))
		);
		render(
			<AdminLayout title="T">
				{(adminFetch) => <button onClick={() => void adminFetch('/api/x')}>go</button>}
			</AdminLayout>
		);
		fireEvent.click(await screen.findByRole('button', { name: 'go' }));
		expect(await screen.findByText('The token was refused.')).toBeInTheDocument();
		const input = screen.getByPlaceholderText('Admin token');
		fireEvent.change(input, { target: { value: 'good' } });
		fireEvent.submit(input.closest('form')!);
		expect(localStorage.getItem('dmm:adminToken')).toBe('good');
	});
});
