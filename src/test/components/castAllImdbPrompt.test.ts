import { afterEach, describe, expect, it, vi } from 'vitest';

const { fire } = vi.hoisted(() => ({
	fire: vi.fn(async (_options: { html: string }) => ({ isConfirmed: false })),
}));
vi.mock('@/components/modals/modal', () => ({ default: { fire } }));
vi.mock('react-hot-toast', () => ({
	default: { loading: vi.fn(), dismiss: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { bindCastAllButton } from '@/components/showInfo/castAll';

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	fire.mockClear();
});

describe('cast-all IMDB prompt', () => {
	// A torrent's name is whatever its uploader typed; the prompt shows it inside modal HTML.
	it('shows a hostile release name as text, never as markup', async () => {
		const name = '<img src=x onerror="alert(document.cookie)">.mkv';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				json: async () => ({ status: 'need_imdb_id', torrentInfo: { filename: name } }),
			}))
		);
		document.body.innerHTML = '<button id="cast-all"></button>';
		bindCastAllButton({ buttonId: 'cast-all', castUrl: '/api/x', apiKey: 'k', filename: 'f' });
		document.getElementById('cast-all')!.click();
		await vi.waitFor(() => expect(fire).toHaveBeenCalled());

		const html = fire.mock.calls[0][0].html;
		expect(html).not.toContain('<img');
		const box = document.createElement('div');
		box.innerHTML = html;
		expect(box.querySelector('img')).toBeNull();
		expect(box.textContent).toContain(name);
	});
});
