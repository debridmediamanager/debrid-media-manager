import paid from '@/test/fixtures/putio/recorded-paid-2026-11-15.json';
import transfers from '@/test/fixtures/putio/transfers.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pt = vi.hoisted(() => ({
	addPutioTransfer: vi.fn(),
	addPutioTransfers: vi.fn(),
	uploadPutioTorrentFile: vi.fn(),
	getPutioTransfer: vi.fn(),
	deletePutioFiles: vi.fn(),
	cancelPutioTransfers: vi.fn(),
	removePutioTransfers: vi.fn(),
}));
vi.mock('@/services/putio', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/putio')>()),
	...pt,
}));

// The library this browser holds, as `putioHeldHashes` reads it.
const held = vi.hoisted(() => ({ rows: [] as { id: string; hash: string }[] }));
vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return { all: async () => held.rows };
	}),
}));

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ __esModule: true, default: toastMock, toast: toastMock }));

import { ADD_MULTI_CHUNK_SIZE, PutioError } from '@/services/putio';
import {
	handleAddAsMagnetInPt,
	handleAddMultipleHashesInPt,
	handleAddMultipleTorrentFilesInPt,
} from './addMagnet';
import { handleDeletePtTorrent } from './deleteTorrent';

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const hashN = (n: number) => n.toString(16).padStart(40, '0');

beforeEach(() => {
	Object.values(pt).forEach((fn) => fn.mockReset());
	held.rows = [];
	toastMock.mockReset();
	toastMock.success.mockReset();
	toastMock.error.mockReset();
});

describe('handleAddAsMagnetInPt', () => {
	it('refuses an invalid hash before calling put.io', async () => {
		await expect(handleAddAsMagnetInPt('k', 'nothex')).rejects.toMatchObject({
			code: 'invalid_info_hash',
		});
		expect(pt.addPutioTransfer).not.toHaveBeenCalled();
	});

	// Recorded: the add answers PREPARING_DOWNLOAD with the magnet as its name and
	// no hash; a moment later the same transfer is COMPLETED and named.
	it('builds the row from a second look at the new transfer (recorded)', async () => {
		const added = paid['transfers-add-known'].body.transfer;
		pt.addPutioTransfer.mockResolvedValue(added);
		pt.getPutioTransfer.mockResolvedValue(paid['transfer-completed'].body.transfer);
		const callback = vi.fn();
		await handleAddAsMagnetInPt('k', HASH, callback);

		expect(pt.addPutioTransfer).toHaveBeenCalledWith('k', `magnet:?xt=urn:btih:${HASH}`);
		expect(pt.getPutioTransfer).toHaveBeenCalledWith('k', added.id);
		const row = callback.mock.calls[0][0];
		expect(row).toMatchObject({ id: `pt:${added.id}`, hash: HASH, filename: 'Big Buck Bunny' });
		expect(toastMock.success).toHaveBeenCalledWith('On put.io — ready.', expect.anything());
	});

	it('falls back to the add answer, titled by its hash, when the second look fails', async () => {
		pt.addPutioTransfer.mockResolvedValue(paid['transfers-add-known'].body.transfer);
		pt.getPutioTransfer.mockRejectedValue(new PutioError('x', 'network_error'));
		const callback = vi.fn();
		await handleAddAsMagnetInPt('k', HASH, callback);
		expect(callback.mock.calls[0][0]).toMatchObject({ hash: HASH, filename: HASH });
		expect(toastMock.success).toHaveBeenCalledWith(
			'Added to put.io — downloading.',
			expect.anything()
		);
	});

	// Recorded: put.io made a second transfer and folder for the same magnet.
	it('does not add a release the library already holds on put.io', async () => {
		held.rows = [{ id: 'pt:9001', hash: HASH }];
		await handleAddAsMagnetInPt('k', `magnet:?xt=urn:btih:${HASH.toUpperCase()}`);
		expect(pt.addPutioTransfer).not.toHaveBeenCalled();
		expect(toastMock).toHaveBeenCalledWith('Already in your put.io.', expect.anything());
	});

	it('still adds a release another provider holds', async () => {
		held.rows = [{ id: 'rd:ABC', hash: HASH }];
		pt.addPutioTransfer.mockResolvedValue(paid['transfers-add-known'].body.transfer);
		pt.getPutioTransfer.mockResolvedValue(paid['transfer-completed'].body.transfer);
		await handleAddAsMagnetInPt('k', HASH);
		expect(pt.addPutioTransfer).toHaveBeenCalledTimes(1);
	});

	it('shows put.io’s readable refusal, never raw API text', async () => {
		pt.addPutioTransfer.mockRejectedValue(
			new PutioError('Your put.io account has no active plan.', 'PaymentRequired', 402)
		);
		await expect(handleAddAsMagnetInPt('k', HASH)).rejects.toBeInstanceOf(PutioError);
		expect(toastMock.error).toHaveBeenCalledWith(
			'Your put.io account has no active plan.',
			expect.anything()
		);
	});
});

describe('handleAddMultipleHashesInPt', () => {
	it('sends chunks of the add-multi size and counts refusals, invalid input included', async () => {
		const sources = [
			...Array.from({ length: ADD_MULTI_CHUNK_SIZE + 3 }, (_, i) => hashN(i + 1)),
			'bad',
		];
		pt.addPutioTransfers.mockImplementation(async (_k: string, urls: string[]) => ({
			transfers: urls.slice(1).map((_, i) => ({ id: i + 1 })),
			errors: [{ error_type: 'INVALID_URL', url: urls[0] }],
		}));
		await handleAddMultipleHashesInPt('k', sources);
		expect(pt.addPutioTransfers).toHaveBeenCalledTimes(2);
		expect(pt.addPutioTransfers.mock.calls[0][1]).toHaveLength(ADD_MULTI_CHUNK_SIZE);
		expect(pt.addPutioTransfers.mock.calls[1][1]).toHaveLength(3);
		expect(pt.addPutioTransfers.mock.calls[0][1][0]).toBe(`magnet:?xt=urn:btih:${hashN(1)}`);
		expect(toastMock).toHaveBeenCalledWith(
			`Added ${ADD_MULTI_CHUNK_SIZE + 1} to put.io — 3 refused.`,
			expect.anything()
		);
	});

	it('leaves out what put.io already holds and repeats within the list', async () => {
		held.rows = [{ id: 'pt:9001', hash: hashN(1) }];
		pt.addPutioTransfers.mockImplementation(async (_k: string, urls: string[]) => ({
			transfers: urls.map((_, i) => ({ id: i + 1 })),
			errors: [],
		}));
		await handleAddMultipleHashesInPt('k', [
			hashN(1),
			hashN(2),
			`magnet:?xt=urn:btih:${hashN(2)}&dn=again`,
		]);
		expect(pt.addPutioTransfers).toHaveBeenCalledTimes(1);
		expect(pt.addPutioTransfers.mock.calls[0][1]).toEqual([`magnet:?xt=urn:btih:${hashN(2)}`]);
		expect(toastMock).toHaveBeenCalledWith(
			'Added 1 to put.io — 2 already there.',
			expect.anything()
		);
	});

	it('stops the sweep on the first refusal of the account, e.g. no space', async () => {
		const sources = Array.from({ length: ADD_MULTI_CHUNK_SIZE * 3 }, (_, i) => hashN(i + 1));
		pt.addPutioTransfers.mockRejectedValue(
			new PutioError(
				'put.io has no free space, or your put.io account has no active plan.',
				'not_enough_space'
			)
		);
		const callback = vi.fn();
		await handleAddMultipleHashesInPt('k', sources, callback);
		expect(pt.addPutioTransfers).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalled();
		expect(toastMock.error).toHaveBeenCalledWith(
			expect.stringMatching(/no free space.*Stopped early\./),
			expect.anything()
		);
	});
});

describe('handleAddMultipleTorrentFilesInPt', () => {
	it('stops uploading once put.io refuses the account', async () => {
		pt.uploadPutioTorrentFile
			.mockResolvedValueOnce({ id: 1 })
			.mockRejectedValueOnce(new PutioError('no plan', 'PaymentRequired', 402));
		const files = [1, 2, 3].map((n) => new File(['d8:announce'], `${n}.torrent`));
		await handleAddMultipleTorrentFilesInPt('k', files);
		expect(pt.uploadPutioTorrentFile).toHaveBeenCalledTimes(2);
		expect(toastMock).toHaveBeenCalledWith(
			'Added 1 torrent file to put.io.',
			expect.anything()
		);
	});
});

describe('handleDeletePtTorrent', () => {
	const seeding = transfers.continue.transfers.find((t) => t.status === 'SEEDING')!;
	const queued = transfers.list.transfers.find((t) => t.status === 'IN_QUEUE')!;

	it('deletes the files first, then cancels, then removes a seeding entry', async () => {
		pt.getPutioTransfer.mockResolvedValue(seeding);
		const order: string[] = [];
		pt.deletePutioFiles.mockImplementation(async () => order.push('files'));
		pt.cancelPutioTransfers.mockImplementation(async () => order.push('cancel'));
		pt.removePutioTransfers.mockImplementation(async () => order.push('remove'));

		await expect(handleDeletePtTorrent('k', `pt:${seeding.id}`)).resolves.toBe(true);
		expect(order).toEqual(['files', 'cancel', 'remove']);
		expect(pt.deletePutioFiles).toHaveBeenCalledWith('k', [seeding.file_id]);
		expect(pt.cancelPutioTransfers).toHaveBeenCalledWith('k', [seeding.id]);
	});

	it('only cancels a transfer that has no files yet', async () => {
		pt.getPutioTransfer.mockResolvedValue(queued);
		await expect(handleDeletePtTorrent('k', `pt:${queued.id}`)).resolves.toBe(true);
		expect(queued.file_id).toBeNull();
		expect(pt.deletePutioFiles).not.toHaveBeenCalled();
		expect(pt.cancelPutioTransfers).toHaveBeenCalledWith('k', [queued.id]);
		expect(pt.removePutioTransfers).not.toHaveBeenCalled();
	});

	it('leaves the transfer alone when deleting its files fails, and does not retry', async () => {
		pt.getPutioTransfer.mockResolvedValue(seeding);
		pt.deletePutioFiles.mockRejectedValue(new PutioError('boom', 'http_500', 500));
		await expect(handleDeletePtTorrent('k', `pt:${seeding.id}`)).resolves.toBe(false);
		expect(pt.deletePutioFiles).toHaveBeenCalledTimes(1);
		expect(pt.cancelPutioTransfers).not.toHaveBeenCalled();
	});

	it('refuses a row id that names no transfer', async () => {
		await expect(handleDeletePtTorrent('k', 'pt:0')).resolves.toBe(false);
		expect(pt.getPutioTransfer).not.toHaveBeenCalled();
	});
});
