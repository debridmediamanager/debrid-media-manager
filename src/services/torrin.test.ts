import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addTorrinMagnet, getTorrinUser, torrinInstantCheck, unrestrictTorrinLink } from './torrin';

const mocks = vi.hoisted(() => ({
	getMock: vi.fn(),
	postMock: vi.fn(),
	deleteMock: vi.fn(),
}));

vi.mock('axios', () => ({
	default: {
		get: mocks.getMock,
		post: mocks.postMock,
		delete: mocks.deleteMock,
	},
}));

const BASE = 'https://torrin.test';
const KEY = 'testkey';

describe('torrin service', () => {
	beforeEach(() => {
		mocks.getMock.mockReset();
		mocks.postMock.mockReset();
		mocks.deleteMock.mockReset();
	});

	it('getTorrinUser hits /rest/1.0/user with Bearer auth', async () => {
		mocks.getMock.mockResolvedValue({ data: { id: 1, username: 'u' } });
		const user = await getTorrinUser(BASE, KEY);
		expect(user.username).toBe('u');
		const [url, cfg] = mocks.getMock.mock.calls[0];
		expect(url).toBe(`${BASE}/rest/1.0/user`);
		expect(cfg.headers.Authorization).toBe(`Bearer ${KEY}`);
	});

	it('trims trailing slashes from the base url', async () => {
		mocks.getMock.mockResolvedValue({ data: {} });
		await getTorrinUser('https://torrin.test///', KEY);
		expect(mocks.getMock.mock.calls[0][0]).toBe(`${BASE}/rest/1.0/user`);
	});

	it('addTorrinMagnet posts a magnet and returns the id', async () => {
		mocks.postMock.mockResolvedValue({ status: 201, data: { id: 'abc' } });
		const id = await addTorrinMagnet(BASE, KEY, '0123456789abcdef0123456789abcdef01234567');
		expect(id).toBe('abc');
		expect(mocks.postMock.mock.calls[0][0]).toBe(`${BASE}/rest/1.0/torrents/addMagnet`);
	});

	it('torrinInstantCheck short-circuits with no hashes', async () => {
		const res = await torrinInstantCheck(BASE, KEY, []);
		expect(res).toEqual({});
		expect(mocks.getMock).not.toHaveBeenCalled();
	});

	it('unrestrictTorrinLink posts to /unrestrict/link', async () => {
		mocks.postMock.mockResolvedValue({ data: { download: 'https://dl' } });
		const r = await unrestrictTorrinLink(BASE, KEY, 'https://host/f');
		expect((r as { download: string }).download).toBe('https://dl');
		expect(mocks.postMock.mock.calls[0][0]).toBe(`${BASE}/rest/1.0/unrestrict/link`);
	});
});
