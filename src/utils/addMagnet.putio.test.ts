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
	listPutioTransfers: vi.fn(),
}));
vi.mock('@/services/putio', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/putio')>()),
	...pt,
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
	// What the account holds, as put.io's live transfer list reports it.
	pt.listPutioTransfers.mockResolvedValue([]);
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

	// Recorded: put.io made a second transfer and folder for the same magnet. On a
	// fresh browser the local library is empty, so only put.io's own list can tell.
	it('asks put.io first and does not add a release it already holds', async () => {
		const completed = paid['transfer-completed'].body.transfer;
		pt.listPutioTransfers.mockResolvedValue([completed]);
		const callback = vi.fn();
		await handleAddAsMagnetInPt('k', `magnet:?xt=urn:btih:${HASH.toUpperCase()}`, callback);
		expect(pt.addPutioTransfer).not.toHaveBeenCalled();
		expect(toastMock).toHaveBeenCalledWith('Already in your put.io.', expect.anything());
		// The page gets the row it already has, so its button shows it.
		expect(callback.mock.calls[0][0]).toMatchObject({ id: `pt:${completed.id}`, hash: HASH });
	});

	it('finds a fresh add put.io has not named yet by the magnet in its source', async () => {
		pt.listPutioTransfers.mockResolvedValue([paid['transfers-add-known'].body.transfer]);
		await handleAddAsMagnetInPt('k', HASH);
		expect(pt.addPutioTransfer).not.toHaveBeenCalled();
	});

	it('adds again when the only transfer with that hash failed', async () => {
		pt.listPutioTransfers.mockResolvedValue([
			{ ...paid['transfer-completed'].body.transfer, status: 'ERROR' },
		]);
		pt.addPutioTransfer.mockResolvedValue(paid['transfers-add-known'].body.transfer);
		pt.getPutioTransfer.mockResolvedValue(paid['transfer-completed'].body.transfer);
		await handleAddAsMagnetInPt('k', HASH);
		expect(pt.addPutioTransfer).toHaveBeenCalledTimes(1);
	});

	it('adds once when the button is pressed twice before the first add answers', async () => {
		pt.addPutioTransfer.mockResolvedValue(paid['transfers-add-known'].body.transfer);
		pt.getPutioTransfer.mockResolvedValue(paid['transfer-completed'].body.transfer);
		await Promise.all([handleAddAsMagnetInPt('k', HASH), handleAddAsMagnetInPt('k', HASH)]);
		expect(pt.listPutioTransfers).toHaveBeenCalledTimes(1);
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
		pt.listPutioTransfers.mockResolvedValue([
			{
				id: 9001,
				status: 'COMPLETED',
				hash: null,
				source: `magnet:?xt=urn:btih:${hashN(1)}`,
			},
		]);
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

	// put.io does not dedupe: a second click, after the first sweep or while it
	// runs, must not add everything again.
	it('lists put.io once per sweep, so a second click adds nothing', async () => {
		const live: unknown[] = [];
		pt.listPutioTransfers.mockImplementation(async () => [...live]);
		pt.addPutioTransfers.mockImplementation(async (_k: string, urls: string[]) => {
			// The add-multi answer names no hash yet; the magnet is in `source` (recorded).
			const made = urls.map((url, i) => ({
				...paid['transfers-add-known'].body.transfer,
				id: 100 + i,
				name: url,
				source: url,
			}));
			live.push(...made);
			return { transfers: made, errors: [] };
		});
		const sources = [hashN(1), hashN(2)];
		await handleAddMultipleHashesInPt('k', sources);
		await handleAddMultipleHashesInPt('k', sources);
		expect(pt.addPutioTransfers).toHaveBeenCalledTimes(1);
		expect(pt.listPutioTransfers).toHaveBeenCalledTimes(2);
		expect(toastMock).toHaveBeenLastCalledWith(
			'Added 0 to put.io — 2 already there.',
			expect.anything()
		);
	});

	it('skips hashes another sweep is adding right now', async () => {
		let release!: () => void;
		pt.listPutioTransfers.mockImplementationOnce(
			() => new Promise((resolve) => (release = () => resolve([])))
		);
		pt.addPutioTransfers.mockResolvedValue({ transfers: [{ id: 1 }], errors: [] });
		const first = handleAddMultipleHashesInPt('k', [hashN(1)]);
		await handleAddMultipleHashesInPt('k', [hashN(1)]);
		release();
		await first;
		expect(pt.addPutioTransfers).toHaveBeenCalledTimes(1);
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

	// Recorded: after files/delete the transfer stays COMPLETED naming the deleted
	// folder; both calls still answer OK, so the row must stay removable.
	it('removes a transfer whose files put.io already deleted', async () => {
		const transfer = paid['transfer-after-file-delete'].body.transfer;
		pt.getPutioTransfer.mockResolvedValue(transfer);
		pt.deletePutioFiles.mockResolvedValue(paid['files-delete-again'].body);
		pt.cancelPutioTransfers.mockResolvedValue(paid['transfers-cancel-completed'].body);

		await expect(handleDeletePtTorrent('k', `pt:${transfer.id}`)).resolves.toBe(true);
		expect(pt.deletePutioFiles).toHaveBeenCalledWith('k', [transfer.file_id]);
		expect(pt.cancelPutioTransfers).toHaveBeenCalledWith('k', [transfer.id]);
		expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/trash/), expect.anything());
	});

	it('deletes put.io rows one at a time, however many are asked for at once', async () => {
		const order: string[] = [];
		pt.getPutioTransfer.mockImplementation(async (_k: string, id: number) => {
			order.push(`get ${id}`);
			return { ...queued, id };
		});
		pt.cancelPutioTransfers.mockImplementation(async (_k: string, [id]: number[]) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			order.push(`cancel ${id}`);
		});

		const results = await Promise.all([
			handleDeletePtTorrent('k', 'pt:1'),
			handleDeletePtTorrent('k', 'pt:2'),
		]);
		expect(results).toEqual([true, true]);
		expect(order).toEqual(['get 1', 'cancel 1', 'get 2', 'cancel 2']);
	});

	// A cancel during another cancel answers 400 TRANSFER_CANCEL_TIMEOUT (docs).
	it('does not report a row deleted when its cancel is refused after its files went', async () => {
		pt.getPutioTransfer.mockResolvedValue(seeding);
		pt.cancelPutioTransfers.mockRejectedValue(
			new PutioError('refused', 'TRANSFER_CANCEL_TIMEOUT', 400)
		);
		await expect(handleDeletePtTorrent('k', `pt:${seeding.id}`)).resolves.toBe(false);
		expect(pt.deletePutioFiles).toHaveBeenCalledTimes(1);
	});

	it('refuses a row id that names no transfer', async () => {
		await expect(handleDeletePtTorrent('k', 'pt:0')).resolves.toBe(false);
		expect(pt.getPutioTransfer).not.toHaveBeenCalled();
	});
});
