import files from '@/test/fixtures/putio/files.json';
import paid from '@/test/fixtures/putio/recorded-paid-2026-11-15.json';
import transfers from '@/test/fixtures/putio/transfers.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	modalFireMock: vi.fn(),
	modalShowLoadingMock: vi.fn(),
	modalCloseMock: vi.fn(),
	handleShareMock: vi.fn(),
	fetchMock: vi.fn(),
}));

vi.mock('../modals/modal', () => ({
	__esModule: true,
	default: {
		fire: mocks.modalFireMock,
		showLoading: mocks.modalShowLoadingMock,
		close: mocks.modalCloseMock,
		showValidationMessage: vi.fn(),
		DismissReason: {},
	},
}));

vi.mock('axios', () => {
	const axiosMock: any = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
	axiosMock.create = vi.fn(() => axiosMock);
	axiosMock.interceptors = {
		request: { use: vi.fn(), eject: vi.fn() },
		response: { use: vi.fn(), eject: vi.fn() },
	};
	return { __esModule: true, default: axiosMock, ...axiosMock };
});

vi.mock('../../utils/hashList', () => ({
	__esModule: true,
	handleShare: mocks.handleShareMock,
}));

import { _testing } from '@/services/putio';
import toast from 'react-hot-toast';
import { showInfoForPT } from './index';

/** The real put.io client over a fetch that answers from the fixtures. */
const route = (url: string) => {
	const { pathname, searchParams } = new URL(url);
	if (pathname === '/v2/transfers/9009')
		return { status: 'OK', transfer: transfers.continue.transfers[0] };
	if (pathname === '/v2/transfers/9010')
		return { status: 'OK', transfer: transfers.continue.transfers[1] };
	if (pathname === '/v2/files/list' && searchParams.get('parent_id') === '1009')
		return files.folder;
	if (pathname === '/v2/files/list' && searchParams.get('parent_id') === '1103')
		return files.subfolder;
	if (pathname === '/v2/files/list' && searchParams.get('parent_id') === '1010')
		return files.singleFile;
	if (/^\/v2\/files\/\d+\/url$/.test(pathname)) return paid['file-url'].body;
	throw new Error(`unrouted ${pathname}`);
};

const row = (id: number) => {
	const transfer = [...transfers.list.transfers, ...transfers.continue.transfers].find(
		(t) => t.id === id
	)!;
	return {
		id: `pt:${id}`,
		hash: transfer.hash!,
		filename: transfer.name,
		title: transfer.name,
		bytes: transfer.size!,
		serviceStatus: transfer.status,
		progress: 100,
		added: new Date('2026-11-09T10:00:00Z'),
	};
};

const htmlOfLastModal = () => mocks.modalFireMock.mock.calls.at(-1)![0].html as string;
const paths = () => mocks.fetchMock.mock.calls.map(([url]) => new URL(url).pathname);

beforeEach(() => {
	_testing.resetRateLimit();
	mocks.fetchMock.mockImplementation(async (url: string) => ({
		ok: true,
		status: 200,
		json: async () => route(url),
	}));
	vi.stubGlobal('fetch', mocks.fetchMock);
	mocks.modalFireMock.mockResolvedValue({ isConfirmed: false });
	mocks.handleShareMock.mockResolvedValue('/hashlist#share');
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('showInfoForPT', () => {
	it('lists a folder transfer file by file, and mints no link until one is asked for', async () => {
		await showInfoForPT('pt-key', row(9009));

		const html = htmlOfLastModal();
		expect(html).toContain('Example.Show.S01E01.1080p.mkv');
		expect(html).toContain('Extras/Readme.txt');
		expect(html).not.toContain('Watch');
		expect(html).not.toContain('pt-key');
		expect(paths().some((p) => p.endsWith('/url'))).toBe(false);
	});

	it('lists a single-file transfer as that file', async () => {
		await showInfoForPT('pt-key', row(9010));

		expect(htmlOfLastModal()).toContain('Example.Movie.2026.1080p.mkv');
		expect(paths()).toEqual(['/v2/transfers/9010', '/v2/files/list']);
	});

	it('mints the link for the clicked file only, in a tab opened by the click', async () => {
		const tab = { location: { href: '' }, close: vi.fn() };
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		mocks.modalFireMock.mockImplementation(async ({ html, didOpen }) => {
			document.body.innerHTML = html;
			didOpen();
			return { isConfirmed: false };
		});

		await showInfoForPT('pt-key', row(9009));
		const button = document.querySelector<HTMLButtonElement>('button[data-pm-file-id="1102"]')!;
		button.click();

		await vi.waitFor(() => expect(tab.location.href).toBe(paid['file-url'].body.url));
		expect(paths().filter((p) => p.endsWith('/url'))).toEqual(['/v2/files/1102/url']);
	});

	// Measured: a link's oauth_token is the account's long-lived download token, and
	// the link served from another IP, so an exported list is a key to the account.
	it('warns that exported links work as a key and must not be shared', async () => {
		const success = vi.spyOn(toast, 'success');
		URL.createObjectURL = vi.fn(() => 'blob:links');
		URL.revokeObjectURL = vi.fn();
		mocks.modalFireMock.mockImplementation(async ({ html, didOpen }) => {
			document.body.innerHTML = html;
			didOpen();
			return { isConfirmed: false };
		});

		await showInfoForPT('pt-key', row(9009));
		document.getElementById('btn-export-links-pt')!.click();

		await vi.waitFor(() =>
			expect(success).toHaveBeenCalledWith(
				expect.stringMatching(/key to your put\.io downloads: do not share them/),
				expect.anything()
			)
		);
	});

	it('refuses a row id that names no transfer', async () => {
		await showInfoForPT('pt-key', { ...row(9009), id: 'pt:' });
		expect(mocks.modalFireMock).not.toHaveBeenCalled();
		expect(mocks.fetchMock).not.toHaveBeenCalled();
	});
});

describe('showInfoForPT on recorded answers', () => {
	type Recorded = { status: number; body: unknown };
	const serve = (routes: Record<string, Recorded>) =>
		mocks.fetchMock.mockImplementation(async (url: string) => {
			const { pathname, searchParams } = new URL(url);
			const key = searchParams.get('parent_id')
				? `${pathname}?${searchParams.get('parent_id')}`
				: pathname;
			const answer = routes[key];
			if (!answer) throw new Error(`unrouted ${key}`);
			return {
				ok: answer.status < 300,
				status: answer.status,
				json: async () => answer.body,
			};
		});
	const recordedRow = (transfer: { id: number; hash: string; name: string; size: number }) => ({
		id: `pt:${transfer.id}`,
		hash: transfer.hash,
		filename: transfer.name,
		title: transfer.name,
		bytes: transfer.size,
		serviceStatus: 'COMPLETED',
		progress: 100,
		added: new Date('2026-11-15T04:01:29Z'),
	});

	it("lists a completed transfer's folder", async () => {
		const transfer = paid['transfer-completed'].body.transfer;
		serve({
			[`/v2/transfers/${transfer.id}`]: paid['transfer-completed'],
			[`/v2/files/list?${transfer.file_id}`]: paid['files-list-folder'],
		});
		await showInfoForPT('pt-key', recordedRow(transfer));
		const html = htmlOfLastModal();
		expect(html).toContain('Big Buck Bunny.mp4');
		expect(html).toContain('Big Buck Bunny.en.srt');
	});

	// files/delete leaves the transfer COMPLETED, still naming the deleted folder.
	it('says the files are gone when put.io no longer has them, and keeps the row removable', async () => {
		const transfer = paid['transfer-after-file-delete'].body.transfer;
		serve({
			[`/v2/transfers/${transfer.id}`]: paid['transfer-after-file-delete'],
			[`/v2/files/list?${transfer.file_id}`]: paid['file-deleted-get'],
		});
		await showInfoForPT('pt-key', recordedRow(transfer));
		expect(htmlOfLastModal()).toContain('These files are no longer on put.io.');
		expect(htmlOfLastModal()).toContain('btn-delete-pt');
	});
});
