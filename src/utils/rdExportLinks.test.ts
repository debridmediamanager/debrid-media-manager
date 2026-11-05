import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRdExportLinks } from './rdExportLinks';

const link = 'https://real-debrid.com/d/ABCDEFGHIJKLMXYZ';

describe('RD export playback credentials', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ userId: 'member' }),
			})
		);
	});

	it('saves the renewable OAuth credential rather than an expiring access token', async () => {
		localStorage.setItem('rd:clientId', JSON.stringify('client'));
		localStorage.setItem('rd:clientSecret', JSON.stringify('secret'));
		localStorage.setItem('rd:refreshToken', JSON.stringify('refresh'));
		const urls = await getRdExportLinks('expiring-access', [link]);
		const [path, init] = vi.mocked(fetch).mock.calls[0];
		expect(path).toBe('/api/stremio/cast/saveProfile');
		expect(JSON.parse(init!.body as string)).toEqual({
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});
		expect(urls).toEqual([`${window.location.origin}/api/stremio/member/play/ABCDEFGHIJKLM`]);
	});

	it('refuses an export when no playback profile could be saved', async () => {
		vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
		await expect(getRdExportLinks('pasted-key', [link])).rejects.toThrow('Failed to prepare');
	});

	it('rejects provider markers before uploading any credentials', async () => {
		await expect(getRdExportLinks('pasted-key', ['debridio:hash'])).rejects.toThrow(
			'non-Real-Debrid'
		);
		expect(fetch).not.toHaveBeenCalled();
	});
});
