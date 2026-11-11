import EasynewsLoginPage from '@/pages/easynews/login';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/router', () => ({
	useRouter: () => ({ replace, query: {} }),
	default: { push: vi.fn() },
}));

// The panel signs in through Easynews; once the login is stored the page
// sends the visitor home, where Easynews search and cast now open.
describe('Easynews login page', () => {
	beforeEach(() => {
		localStorage.clear();
		replace.mockReset();
	});

	it('stays put until signed in', () => {
		render(<EasynewsLoginPage />);
		expect(replace).not.toHaveBeenCalled();
	});

	it('goes home once the Easynews login is stored', async () => {
		localStorage.setItem('en:account', JSON.stringify({ username: 'u', password: 'p' }));
		render(<EasynewsLoginPage />);
		await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
	});
});
