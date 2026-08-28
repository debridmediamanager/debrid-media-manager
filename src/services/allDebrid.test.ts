import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkPin,
	checkPinOnce,
	deleteMagnet,
	getAllDebridUser,
	getMagnetFiles,
	getMagnetStatus,
	getPin,
	restartMagnet,
	uploadMagnet,
} from './allDebrid';

const mocks = vi.hoisted(() => ({
	getMock: vi.fn(),
	postMock: vi.fn(),
	requestMock: vi.fn(),
}));

vi.mock('axios', () => ({
	default: {
		get: mocks.getMock,
		post: mocks.postMock,
		create: vi.fn(() => ({
			get: mocks.getMock,
			post: mocks.postMock,
			request: mocks.requestMock,
			interceptors: {
				request: { use: vi.fn(), eject: vi.fn() },
				response: { use: vi.fn(), eject: vi.fn() },
			},
		})),
	},
}));

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			allDebridHostname: 'https://alldebrid.test',
		},
	}),
}));

const { getMock, postMock } = mocks;

describe('AllDebrid service helpers', () => {
	beforeEach(() => {
		getMock.mockReset();
		postMock.mockReset();
	});

	it('fetches a PIN and surfaces API errors', async () => {
		getMock.mockResolvedValueOnce({
			data: { status: 'success', data: { pin: '1234', check: 'check', expires_in: 10 } },
		});
		const pinData = await getPin();
		expect(pinData.pin).toBe('1234');

		getMock.mockResolvedValueOnce({
			data: { status: 'error', error: { message: 'bad' } },
		});
		await expect(getPin()).rejects.toThrow('bad');
	});

	it('polls PIN activation until ready', async () => {
		postMock
			.mockResolvedValueOnce({
				data: { status: 'success', data: { activated: false, expires_in: 10 } },
			})
			.mockResolvedValueOnce({
				data: {
					status: 'success',
					data: { activated: true, apikey: 'key', expires_in: 10 },
				},
			});
		vi.useFakeTimers();
		const promise = checkPin('pin', 'check');
		await vi.advanceTimersByTimeAsync(5000);
		const result = await promise;
		expect(result.apikey).toBe('key');
		vi.useRealTimers();
	});

	it('checks a PIN exactly once when the caller owns the waiting', async () => {
		postMock.mockResolvedValueOnce({
			data: { status: 'success', data: { activated: false, expires_in: 10 } },
		});

		const result = await checkPinOnce('pin', 'check');

		expect(result.activated).toBe(false);
		expect(postMock).toHaveBeenCalledTimes(1);
	});

	it('fetches user info and uploads magnets', async () => {
		getMock.mockResolvedValueOnce({
			data: { status: 'success', data: { user: { username: 'demo' } } },
		});
		const user = await getAllDebridUser('token');
		expect(user.username).toBe('demo');

		postMock.mockResolvedValueOnce({
			data: { status: 'success', data: { magnets: [{ id: 1 }] } },
		});
		const upload = await uploadMagnet('token', ['abcdef', 'magnet:?xt=urn:btih:deadbeef']);
		expect(upload.magnets).toHaveLength(1);

		postMock.mockResolvedValueOnce({
			data: { status: 'error', error: { message: 'invalid magnet' } },
		});
		await expect(uploadMagnet('token', ['invalid'])).rejects.toThrow('invalid magnet');
	});

	it('carries the error code out of a refused user lookup', async () => {
		// The login page tells "wrong key" from "blocked caller" by this code;
		// the message alone cannot separate them.
		getMock.mockResolvedValueOnce({
			data: {
				status: 'error',
				error: { code: 'AUTH_BAD_APIKEY', message: 'The auth apikey is invalid' },
			},
		});

		await expect(getAllDebridUser('bad')).rejects.toMatchObject({
			code: 'AUTH_BAD_APIKEY',
			message: 'The auth apikey is invalid',
		});
	});

	it('retrieves magnet status and converts files to links', async () => {
		postMock.mockResolvedValueOnce({
			data: {
				status: 'success',
				data: {
					magnets: [
						{
							id: 10,
							statusCode: 4,
							links: [],
							files: [{ n: 'file.mkv', l: 'https://link', s: 100 }],
						},
					],
				},
			},
		});

		const response = await getMagnetStatus('token');
		expect(response.data.magnets[0].links?.[0].filename).toContain('file.mkv');
	});

	it('returns empty magnet files when ids are invalid', async () => {
		const empty = await getMagnetFiles('token', [0, -1]);
		expect(empty.magnets).toEqual([]);

		postMock.mockResolvedValueOnce({
			data: { status: 'success', data: { magnets: [] } },
		});
		await getMagnetFiles('token', [1]);
	});

	it('deletes and restarts magnets', async () => {
		postMock.mockResolvedValueOnce({
			data: { status: 'success', data: { message: 'ok' } },
		});
		const deleteResp = await deleteMagnet('token', '1');
		expect(deleteResp.message).toBe('ok');

		postMock.mockResolvedValueOnce({
			data: { status: 'success', data: { magnets: [{ magnet: 'm1' }] } },
		});
		const restartResp = await restartMagnet('token', '1');
		expect(restartResp.magnets?.[0].magnet).toBe('m1');
	});
});
