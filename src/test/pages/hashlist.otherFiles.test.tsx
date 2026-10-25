import HashlistPage from '@/pages/hashlist';
import type { Hashlist } from '@/services/mediasearch';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import lzString from 'lz-string';
import path from 'path';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Two releases of one film from a real shared list (fixtures/hashlist/README.md).
const corpus = JSON.parse(
	lzString.decompressFromEncodedURIComponent(
		readFileSync(
			path.join(
				__dirname,
				'../fixtures/hashlist/421ab9ff-ed7f-4c0b-9f66-ee91f12d57eb.fragment.txt'
			),
			'utf8'
		)
	)
) as Hashlist;
const ENDGAME = new Set([
	'be2abb78a6b93be1510c4507d2d3326db5256224',
	'b3a4347acd63583759ca814d8e2d1556be80e7b4',
]);
const FRAGMENT = lzString.compressToEncodedURIComponent(
	JSON.stringify({
		title: corpus.title,
		torrents: corpus.torrents.filter(({ hash }) => ENDGAME.has(hash)),
	})
);

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
	useAllDebridApiKey: vi.fn(() => null),
	useTorBoxAccessToken: vi.fn(() => null),
	usePremiumizeCredential: vi.fn(() => null),
	useOffcloudApiKey: vi.fn(() => null),
	useDebridLinkCredential: vi.fn(() => null),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: vi.fn(() => ({
		addTorrent: vi.fn(),
		removeTorrent: vi.fn(),
		lastFetchTime: null,
	})),
}));

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return {
			initializeDB: vi.fn().mockResolvedValue(undefined),
			all: vi.fn().mockResolvedValue([]),
			hashes: vi.fn().mockResolvedValue(new Set()),
		};
	}),
}));

vi.mock('@/utils/takedownClient', () => ({
	fetchBlockedHashes: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock('react-hot-toast', () => ({
	toast: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
		loading: vi.fn(),
		custom: vi.fn(),
		dismiss: vi.fn(),
	}),
	Toaster: () => null,
}));

describe('HashlistPage "other files" chip', () => {
	beforeEach(() => {
		Object.defineProperty(window, 'location', {
			writable: true,
			value: { hash: `#${FRAGMENT}`, reload: vi.fn() },
		});
		vi.spyOn(window.sessionStorage.__proto__, 'getItem').mockReturnValue(null);
	});

	// The counts were stored by title and read by filename, so the chip never
	// showed; its link went to /library?filter=, which the library ignores.
	it('links each release to the other one in this list', async () => {
		render(<HashlistPage />);

		const chips = await screen.findAllByRole('link', { name: '1 other file' });
		expect(chips).toHaveLength(2);
		for (const chip of chips) {
			expect(chip).toHaveAttribute(
				'href',
				`/hashlist?filter=${encodeURIComponent('Avengers Endgame (2019)')}`
			);
		}
	});
});
