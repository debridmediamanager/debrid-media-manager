import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fire: vi.fn(), unrestrict: vi.fn() }));
vi.mock('../modals/modal', () => ({
	default: { fire: mocks.fire, showLoading: vi.fn(), close: vi.fn() },
}));
vi.mock('@/services/realDebrid', () => ({
	proxyUnrestrictLink: mocks.unrestrict,
	addHashAsMagnet: vi.fn(),
	selectFiles: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
	default: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('../../utils/hashList', () => ({ handleShare: vi.fn().mockResolvedValue('') }));
vi.mock('./watchButtons', () => ({ bindWatchButtons: vi.fn() }));
vi.mock('./utils', async () => ({
	...(await vi.importActual<typeof import('./utils')>('./utils')),
	fetchMediaInfo: vi.fn(async () => null),
	getStreamInfo: vi.fn(() => []),
}));

import { showInfoForRD } from './index';

const link = 'https://real-debrid.com/d/ABCDEFGHIJKLMXYZ';
const info = {
	id: 'SYNTHETICTORRENT',
	hash: '0123456789abcdef0123456789abcdef01234567',
	filename: 'Sintel.mp4',
	original_filename: 'Sintel.mp4',
	bytes: 1024,
	original_bytes: 1024,
	progress: 100,
	status: 'downloaded',
	fake: false,
	added: '2026-11-05T01:00:00Z',
	links: [link],
	files: [{ id: 1, path: '/Sintel.mp4', selected: 1, bytes: 1024 }],
};

describe('RD persistent exports', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		URL.createObjectURL = vi.fn(() => 'blob:export');
		URL.revokeObjectURL = vi.fn();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		mocks.unrestrict.mockResolvedValue({
			download: 'https://cdn.example/seven-day-url',
			filename: 'Sintel.mp4',
			streamable: 1,
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ userId: 'cast-member' }),
			})
		);
	});

	it.each(['btn-generate-strm', 'btn-export-links'])(
		'%s stores a re-resolving play URL, not the seven-day CDN URL',
		async (button) => {
			await showInfoForRD('windows/vlc', 'private-key', info);
			const options = mocks.fire.mock.calls[0][0];
			document.body.innerHTML = options.html;
			options.didOpen();
			document.getElementById(button)!.click();
			await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
			const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
			const { promise, resolve } = Promise.withResolvers<string>();
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.readAsText(blob);
			const text = await promise;
			expect(text.trim()).toBe(
				`${window.location.origin}/api/stremio/cast-member/play/ABCDEFGHIJKLM`
			);
			expect(text).not.toContain('private-key');
		}
	);
});
