import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/admin/reports' }) }));
vi.mock('next/head', () => ({
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/poster', () => ({
	default: ({ imdbId, title }: { imdbId: string; title?: string }) => (
		<img alt={`Poster for ${title}`} data-imdb={imdbId} />
	),
}));

const ad = vi.hoisted(() => ({
	uploadMagnet: vi.fn(),
	getMagnetLinks: vi.fn(),
	unlockLink: vi.fn(),
	deleteMagnet: vi.fn(async () => ({ message: 'ok' })),
}));
vi.mock('@/services/allDebrid', () => ad);

import ReportsAdminPage from '@/pages/admin/reports';

const report = (over: Record<string, unknown> = {}) => ({
	imdbId: 'tt1254207',
	hash: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
	title: 'Big Buck Bunny',
	year: 2008,
	kind: 'movie',
	filename: 'Big.Buck.Bunny.2008.1080p.mkv',
	seasons: [],
	types: ['wrong_imdb'],
	reporters: 1,
	model: null,
	lastReportedAt: '2026-11-11T09:00:00.000Z',
	decision: null,
	note: null,
	decidedAt: null,
	...over,
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('/admin/reports', () => {
	it('shows each report with its poster and a link to the title page', async () => {
		localStorage.setItem('dmm:adminToken', 'token');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							total: 2,
							counts: { all: 2, agrees: 0, disagrees: 0, unjudged: 2 },
							items: [
								report(),
								report({
									imdbId: 'tt0903747',
									title: 'Breaking Bad',
									year: 2008,
									kind: 'show',
								}),
							],
						})
					)
			)
		);
		render(<ReportsAdminPage />);

		const poster = await screen.findByAltText('Poster for Big Buck Bunny');
		expect(poster.getAttribute('data-imdb')).toBe('tt1254207');
		expect(
			screen.getByRole('link', { name: 'Big Buck Bunny (2008)' }).getAttribute('href')
		).toBe('/movie/tt1254207');
		expect(screen.getByRole('link', { name: 'Breaking Bad (2008)' }).getAttribute('href')).toBe(
			'/show/tt0903747'
		);
	});

	it('says which season a show release is listed on, links its magnet, and looks inside it', async () => {
		localStorage.setItem('dmm:adminToken', 'token');
		const hash = '02b883174411aaaabbbbccccddddeeeeffff0000';
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
			init?.method === 'POST'
				? new Response(
						JSON.stringify({
							cached: true,
							provider: 'premiumize',
							files: [
								{
									path: 'The Traitors S04E10/About this torrent.txt',
									size: 900,
									link: 'https://cdn/about.txt',
									streamLink: null,
								},
								{
									path: 'The Traitors S04E10/The Traitors S04E10.mp4',
									size: 2520000000,
									link: 'https://cdn/dl.mp4',
									streamLink: 'https://cdn/stream.mp4',
								},
							],
						})
					)
				: new Response(
						JSON.stringify({
							total: 1,
							counts: { all: 1, agrees: 0, disagrees: 1, unjudged: 0 },
							items: [
								report({
									imdbId: 'tt15557874',
									hash,
									title: 'The Traitors',
									year: 2023,
									kind: 'show',
									filename: 'The Traitors S04E10',
									seasons: [4],
									types: ['wrong_season'],
								}),
							],
						})
					)
		);
		vi.stubGlobal('fetch', fetchMock);
		render(<ReportsAdminPage />);

		const season = await screen.findByRole('link', { name: 'season 4' });
		expect(season.getAttribute('href')).toBe('/show/tt15557874/4');
		expect(screen.getByRole('link', { name: 'magnet' }).getAttribute('href')).toBe(
			`magnet:?xt=urn:btih:${hash}&dn=The%20Traitors%20S04E10`
		);

		fireEvent.click(screen.getByRole('button', { name: 'Look inside' }));
		expect(await screen.findByText('The Traitors S04E10.mp4')).toBeInTheDocument();
		expect(screen.getByText('2.52 GB')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'play' }).getAttribute('href')).toBe(
			'https://cdn/stream.mp4'
		);
		const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
		expect(JSON.parse(String(init!.body))).toEqual({ action: 'inspect', hash });
	});

	it('says when only Real-Debrid had the file list, and offers nothing to play', async () => {
		localStorage.setItem('dmm:adminToken', 'token');
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) =>
				init?.method === 'POST'
					? new Response(
							JSON.stringify({
								cached: true,
								provider: 'realdebrid',
								files: [
									{
										path: 'Show/Show.S04E10.mkv',
										size: 2520000000,
										link: null,
										streamLink: null,
									},
								],
							})
						)
					: new Response(
							JSON.stringify({
								total: 1,
								counts: { all: 1, agrees: 0, disagrees: 0, unjudged: 1 },
								items: [report()],
							})
						)
			)
		);
		render(<ReportsAdminPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Look inside' }));
		expect(await screen.findByText('Show.S04E10.mkv')).toBeInTheDocument();
		expect(screen.getByText(/From Real-Debrid: the file list only/)).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'play' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'download' })).toBeNull();
	});

	it('plays through AllDebrid from this browser once a key is saved here', async () => {
		localStorage.setItem('dmm:adminToken', 'token');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							total: 1,
							counts: { all: 1, agrees: 0, disagrees: 0, unjudged: 1 },
							items: [report()],
						})
					)
			)
		);
		const { unmount } = render(<ReportsAdminPage />);
		await screen.findByText('Big.Buck.Bunny.2008.1080p.mkv');
		expect(screen.queryByRole('button', { name: 'Play via AllDebrid' })).toBeNull();
		unmount();

		localStorage.setItem('dmm:adminAllDebridKey', 'ADKEY123');
		ad.uploadMagnet.mockResolvedValue({ magnets: [{ id: 42, ready: true, magnet: '' }] });
		ad.getMagnetLinks.mockResolvedValue([
			{
				filename: 'Big Buck Bunny.mp4',
				size: 276134947,
				link: 'https://alldebrid.com/f/abc',
				files: [],
			},
			{
				filename: 'Big Buck Bunny.en.srt',
				size: 140,
				link: 'https://alldebrid.com/f/srt',
				files: [],
			},
		]);
		ad.unlockLink.mockResolvedValue({ link: 'https://cdn.example/bbb.mp4' });
		const tab = { location: { href: '' }, close: vi.fn() };
		const open = vi.fn(() => tab);
		vi.stubGlobal('open', open);
		render(<ReportsAdminPage />);

		expect(
			await screen.findByText(/AllDebrid key in this browser \(…123\)/)
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Play via AllDebrid' }));
		expect(await screen.findByText('Big Buck Bunny.mp4')).toBeInTheDocument();
		expect(ad.uploadMagnet).toHaveBeenCalledWith('ADKEY123', [report().hash]);
		// one play button: the video's, not the subtitles'
		const play = screen.getByRole('button', { name: 'play' });
		fireEvent.click(play);
		await vi.waitFor(() => expect(tab.location.href).toBe('https://cdn.example/bbb.mp4'));
		expect(open).toHaveBeenCalledWith('', '_blank');
		expect(ad.unlockLink).toHaveBeenCalledWith('ADKEY123', 'https://alldebrid.com/f/abc');
	});
});
