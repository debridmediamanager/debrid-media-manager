import tbEntry from '@/test/fixtures/torbox/mylist-entry-349-files-2026-10-22.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	fire: vi.fn(),
	loading: vi.fn(() => 'toast-id'),
	requestDownloadLink: vi.fn(),
}));

vi.mock('../modals/modal', () => ({
	default: { fire: mocks.fire, showLoading: vi.fn(), close: vi.fn() },
}));
vi.mock('axios', () => {
	const axiosMock: any = { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn() };
	axiosMock.create = vi.fn(() => axiosMock);
	axiosMock.interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
	return { __esModule: true, default: axiosMock, AxiosError: class {} };
});
vi.mock('react-hot-toast', () => ({
	default: { loading: mocks.loading, success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@/services/torbox', () => ({
	requestDownloadLink: mocks.requestDownloadLink,
	requestWebDownloadLink: vi.fn(),
}));
vi.mock('../../utils/hashList', () => ({ handleShare: vi.fn().mockResolvedValue('') }));
vi.mock('./watchButtons', () => ({ bindWatchButtons: vi.fn() }));
vi.mock('./utils', async () => ({
	...(await vi.importActual<typeof import('./utils')>('./utils')),
	fetchMediaInfo: vi.fn(async () => null),
	getStreamInfo: vi.fn(() => []),
}));

import { showInfoForTB } from './index';

// Card 402: Get Links on a big TorBox pack asks for one link per file, paced to
// TorBox's requestdl limit. Live on 2026-10-22 this 349-file pack took 279 s
// behind a toast that never changed, which reads as a spinner that never ends.
describe('TorBox Get Links', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		URL.createObjectURL = vi.fn(() => 'blob:x');
		URL.revokeObjectURL = vi.fn();
		mocks.requestDownloadLink.mockImplementation(async (_key, { file_id }) => ({
			data: `https://cdn.example/${file_id}`,
		}));
	});

	it('shows how many of the files it has fetched so far', async () => {
		await showInfoForTB('windows/vlc', 'tb-key', tbEntry as any, false);
		const options = mocks.fire.mock.calls[0][0];
		document.body.innerHTML = options.html;
		options.didOpen?.();

		document.getElementById('btn-export-links')!.click();
		await vi.waitFor(() => expect(mocks.requestDownloadLink).toHaveBeenCalledTimes(349));
		await vi.waitFor(() =>
			expect(mocks.loading).toHaveBeenCalledWith(
				expect.stringContaining('349/349'),
				expect.objectContaining({ id: 'toast-id' })
			)
		);
	});
});
