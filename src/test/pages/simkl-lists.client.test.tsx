import type * as SimklService from '@/services/simkl';
import { act, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import listFixture from '../fixtures/simkl/list-items-200.json';
import listsFixture from '../fixtures/simkl/user-lists-200.json';
import profileFixture from '../fixtures/simkl/user-settings-200.json';

const state = vi.hoisted(() => ({
	auth: {
		cacheKey: 'account-a',
		user: null as typeof profileFixture | null,
		error: null as Error | null,
		loading: false,
		hasAuth: true,
	},
	router: { isReady: true, query: { id: '216324' } },
	getList: vi.fn(),
	getLists: vi.fn(),
}));
vi.mock('@/hooks/auth', () => ({ useSimklAuth: () => state.auth }));
vi.mock('@/utils/withAuth', () => ({ withAuth: (component: ComponentType) => component }));
vi.mock('next/router', () => ({ useRouter: () => state.router }));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('@/components/poster', () => ({
	default: ({ title }: { title: string }) => <span>{title}</span>,
}));
vi.mock('react-hot-toast', () => ({ Toaster: () => null, default: { error: vi.fn() } }));
vi.mock('@/services/simkl', async (importOriginal) => ({
	...(await importOriginal<typeof SimklService>()),
	getSimklList: state.getList,
	getSimklUserLists: state.getLists,
}));

import { clearCachedList } from '@/hooks/useCachedList';
import SimklListPage from '@/pages/simkl/list/[id]';
import SimklMyLists from '@/pages/simkl/mylists';
import { SimklError } from '@/services/simkl';

beforeEach(() => {
	vi.clearAllMocks();
	clearCachedList();
	state.auth = {
		cacheKey: 'account-a',
		user: profileFixture,
		error: null,
		loading: false,
		hasAuth: true,
	};
	state.router = { isReady: true, query: { id: '216324' } };
	state.getList.mockResolvedValue(listFixture);
	state.getLists.mockResolvedValue(listsFixture.lists);
});

describe('Simkl custom list access', () => {
	it('offers sign-in rather than a false empty list without a Simkl session', () => {
		state.auth = { ...state.auth, cacheKey: '', user: null, hasAuth: false };
		render(<SimklListPage />);
		expect(screen.getByRole('button', { name: 'Simkl Login' })).toBeInTheDocument();
		expect(screen.queryByText('This list is empty.')).not.toBeInTheDocument();
	});

	it('waits for cold account authentication instead of declaring no custom lists', () => {
		state.auth = { ...state.auth, cacheKey: '', user: null, loading: true };
		render(<SimklMyLists />);
		expect(screen.getByRole('status')).toHaveTextContent('Loading Simkl account');
		expect(screen.queryByText(/No custom lists/)).not.toBeInTheDocument();
	});

	it('offers reauthentication after an expired account cannot be refreshed', () => {
		state.auth = {
			...state.auth,
			cacheKey: '',
			user: null,
			hasAuth: false,
			error: new SimklError('user_token_required', 'Expired Simkl session', 401),
		};
		render(<SimklMyLists />);
		expect(screen.getByRole('button', { name: 'Simkl Login' })).toBeInTheDocument();
		expect(screen.getByText(/Expired Simkl session/)).toBeInTheDocument();
		expect(screen.queryByText(/No custom lists/)).not.toBeInTheDocument();
	});

	it('rejects a malformed list route instead of showing an empty list', () => {
		state.router.query.id = '1e3';
		render(<SimklListPage />);
		expect(screen.getByText(/Invalid Simkl list ID/)).toBeInTheDocument();
		expect(screen.queryByText('This list is empty.')).not.toBeInTheDocument();
	});

	it('does not expose a previous account’s cached private list after switching accounts', async () => {
		const page = render(<SimklListPage />);
		await screen.findByText('Stranger Things');
		state.getList.mockRejectedValue(new SimklError('private_list', 'Private list', 403));
		state.auth = {
			...state.auth,
			cacheKey: 'account-b',
			user: { ...profileFixture, account: { ...profileFixture.account, id: 2 } },
		};
		page.rerender(<SimklListPage />);
		expect(screen.queryByText('Stranger Things')).not.toBeInTheDocument();
		await screen.findByText(/This Simkl list is private/);
		expect(screen.queryByText('Stranger Things')).not.toBeInTheDocument();
	});

	it('ignores an old account’s slow list response after switching accounts', async () => {
		const { promise, resolve: finish } = Promise.withResolvers<typeof listFixture>();
		state.getList.mockReturnValueOnce(promise);
		const page = render(<SimklListPage />);
		state.getList.mockRejectedValue(new SimklError('private_list', 'Private list', 403));
		state.auth = {
			...state.auth,
			cacheKey: 'account-b',
			user: { ...profileFixture, account: { ...profileFixture.account, id: 2 } },
		};
		page.rerender(<SimklListPage />);
		await screen.findByText(/This Simkl list is private/);
		await act(async () => {
			finish(listFixture);
		});
		expect(screen.queryByText('Stranger Things')).not.toBeInTheDocument();
	});

	it('removes list content immediately when Simkl signs out', async () => {
		const page = render(<SimklListPage />);
		await screen.findByText('Stranger Things');
		state.auth = { ...state.auth, cacheKey: '', user: null, hasAuth: false };
		page.rerender(<SimklListPage />);
		expect(screen.queryByText('Stranger Things')).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Simkl Login' })).toBeInTheDocument();
	});

	it('does not display an old account’s list names while the new account loads', async () => {
		const page = render(<SimklMyLists />);
		await screen.findByText('Regular TV list');
		state.getLists.mockReturnValue(Promise.withResolvers().promise);
		state.auth = {
			...state.auth,
			cacheKey: 'account-b',
			user: { ...profileFixture, account: { ...profileFixture.account, id: 2 } },
		};
		page.rerender(<SimklMyLists />);
		expect(screen.queryByText('Regular TV list')).not.toBeInTheDocument();
	});

	it('isolates a new grant for the same account from its previous private cache', async () => {
		const page = render(<SimklMyLists />);
		await screen.findByText('Regular TV list');
		state.getLists.mockRejectedValue(new SimklError('premium_only', 'Upgrade required', 403));
		state.auth = { ...state.auth, cacheKey: 'same-account-new-grant' };
		page.rerender(<SimklMyLists />);
		expect(screen.queryByText('Regular TV list')).not.toBeInTheDocument();
		await screen.findByText(/custom lists need PRO or VIP/i);
		expect(screen.queryByText('Regular TV list')).not.toBeInTheDocument();
	});
});
