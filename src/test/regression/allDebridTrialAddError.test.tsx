// Fizzy #363: an AllDebrid trial account got "Failed to add hash. Try again."
// for every refused add. The upload bodies come from AllDebrid's documented
// shapes (see the fixture's _provenance); only axios is mocked, so the real
// service turns them into errors.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bodies from '../fixtures/allDebridTrial/magnet-upload-errors.json';
import list from '../fixtures/hashlist/fe6e0436-b0c4-4163-9fbd-86a25a274396.json';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('axios', () => {
	const instance = {
		get: vi.fn(),
		post: postMock,
		request: vi.fn(),
		interceptors: {
			request: { use: vi.fn(), eject: vi.fn() },
			response: { use: vi.fn(), eject: vi.fn() },
		},
	};
	return { default: { ...instance, create: vi.fn(() => instance), isAxiosError: () => false } };
});

vi.mock('react-hot-toast', () => {
	const toast = Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
		loading: vi.fn(),
		custom: vi.fn(),
		dismiss: vi.fn(),
	});
	return { __esModule: true, default: toast, toast, Toaster: () => null };
});

vi.mock('next/router', () => ({
	useRouter: vi.fn(() => ({
		push: vi.fn(),
		replace: vi.fn(),
		query: {},
		pathname: '/hashlist',
		asPath: '/hashlist',
		events: { on: vi.fn(), off: vi.fn() },
	})),
}));
vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(() => [null, false, false]),
	useAllDebridApiKey: vi.fn(() => 'ad-key'),
	useTorBoxAccessToken: vi.fn(() => null),
	usePremiumizeCredential: vi.fn(() => null),
	useOffcloudApiKey: vi.fn(() => null),
	useDebridLinkCredential: vi.fn(() => null),
}));
vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: vi.fn(() => ({ addTorrent: vi.fn(), removeTorrent: vi.fn() })),
}));
vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return {
			initializeDB: vi.fn().mockResolvedValue(undefined),
			all: vi.fn().mockResolvedValue([]),
			hashes: vi.fn().mockResolvedValue(new Set()),
			addAll: vi.fn().mockResolvedValue(undefined),
			getAllByHash: vi.fn().mockResolvedValue([]),
			deleteByHash: vi.fn().mockResolvedValue(undefined),
		};
	}),
}));
vi.mock('lz-string', () => ({
	__esModule: true,
	default: { decompressFromEncodedURIComponent: vi.fn(() => JSON.stringify(list)) },
}));
vi.mock('@/utils/takedownClient', () => ({
	fetchBlockedHashes: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock('@/utils/token', () => ({
	generateTokenAndHash: vi.fn().mockResolvedValue(['problem', 'solution']),
}));
vi.mock('@/utils/instantChecks', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/instantChecks')>()),
	checkPlayableAvailabilityAd: vi.fn(async () => 0),
	wrapLoading: (_service: string, p: Promise<number>) => p,
}));

const HASH = '842783e3005495d5d1637f5364b59343c7844707';
const TRIAL =
	"AllDebrid's free trial or expired plan does not allow this; it works once you subscribe.";
const cases = [
	['MAGNET_MUST_BE_PREMIUM', TRIAL],
	['FREE_TRIAL_LIMIT_REACHED', TRIAL],
	['MAGNET_TOO_MANY_ACTIVE', 'AllDebrid error: Already have maximum allowed active magnets (30)'],
] as const;
const shapes = ['envelope', 'perMagnet'] as const;
const matrix = shapes.flatMap((shape) => cases.map(([code, msg]) => [shape, code, msg] as const));

const answer = (shape: (typeof shapes)[number], code: (typeof cases)[number][0]) =>
	postMock.mockImplementation(async (url: string) => ({
		data: url.endsWith('/magnet/status')
			? { status: 'success', data: { magnets: [] } }
			: bodies[shape][code],
	}));

describe('AllDebrid refused adds name the reason (Fizzy #363)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(matrix)('Check AD / Instant AD, %s %s', async (shape, code, msg) => {
		const toast = (await import('react-hot-toast')).default;
		const { handleAddAsMagnetInAd } = await import('@/utils/addMagnet');
		answer(shape, code);
		await expect(handleAddAsMagnetInAd('ad-key', HASH)).rejects.toThrow();
		expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([msg]);
	});

	it.each(matrix)('multiple hashes, %s %s', async (shape, code, msg) => {
		const toast = (await import('react-hot-toast')).default;
		const { handleAddMultipleHashesInAd } = await import('@/utils/addMagnet');
		answer(shape, code);
		await handleAddMultipleHashesInAd('ad-key', [HASH]);
		expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([msg]);
	});

	it.each(matrix)('hashlist AD button, %s %s', async (shape, code, msg) => {
		Object.defineProperty(window, 'location', {
			writable: true,
			value: { hash: '#list', reload: vi.fn() },
		});
		const toast = (await import('react-hot-toast')).default;
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);
		fireEvent.click(await screen.findByText('Show All'));
		const [button] = await screen.findAllByRole('button', { name: /^AD$/ });
		answer(shape, code);
		fireEvent.click(button);
		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([msg]);
	});
});
