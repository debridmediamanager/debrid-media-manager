import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { runConcurrentFunctions } from './batch';
import { deleteFilteredTorrents } from './deleteList';

vi.mock('react-hot-toast', () => {
	const toastFn: any = vi.fn();
	toastFn.loading = vi.fn();
	toastFn.success = vi.fn();
	toastFn.error = vi.fn();
	toastFn.dismiss = vi.fn();
	return { default: toastFn };
});

vi.mock('./batch', () => ({
	runConcurrentFunctions: vi.fn(),
}));

const runConcurrentFunctionsMock = runConcurrentFunctions as unknown as Mock;
const toastLoadingMock = toast.loading as unknown as Mock;

describe('deleteFilteredTorrents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runConcurrentFunctionsMock.mockReset();
		toastLoadingMock.mockReturnValue('toast-id');
	});

	it('notifies the user when there are no torrents to delete', async () => {
		await deleteFilteredTorrents([], () => () => Promise.resolve(''));

		expect(toast).toHaveBeenCalledWith('No torrents to delete.', expect.any(Object));
		expect(runConcurrentFunctionsMock).not.toHaveBeenCalled();
	});

	it('runs deletions concurrently and reports progress and success', async () => {
		const torrents = [{ id: 'a' }, { id: 'b' }] as any[];

		runConcurrentFunctionsMock.mockImplementationOnce(
			async (
				funcs: Array<() => Promise<any>>,
				_concurrency: number,
				_delay: number,
				onProgress?: (completed: number, total: number, errorCount: number) => void
			) => {
				onProgress?.(1, funcs.length, 0);
				return [[{ id: 'a' }], []];
			}
		);

		const wrapDeleteFn = (torrent: any) => vi.fn(async () => torrent.id);

		await deleteFilteredTorrents(torrents, wrapDeleteFn);

		expect(runConcurrentFunctionsMock).toHaveBeenCalled();
		expect(toast.loading).toHaveBeenNthCalledWith(
			1,
			'Deleting 0/2 torrents...',
			expect.any(Object)
		);
		expect(toast.loading).toHaveBeenNthCalledWith(2, 'Deleting 1/2 torrents...', {
			id: 'toast-id',
		});
		expect(toast.success).toHaveBeenCalledWith(
			'Deleted 1 torrents.',
			expect.objectContaining({ id: 'toast-id' })
		);
	});

	it('reports mixed results when some deletions fail', async () => {
		const torrents = [{ id: 'a' }] as any[];
		runConcurrentFunctionsMock.mockResolvedValueOnce([[{ id: 'a' }], [new Error('fail')]]);

		await deleteFilteredTorrents(torrents, () => vi.fn(async () => ''));

		expect(toast.error).toHaveBeenCalledWith(
			'Deleted 1; 1 failed.',
			expect.objectContaining({ id: 'toast-id' })
		);
	});

	it('reports failures when every deletion fails', async () => {
		const torrents = [{ id: 'a' }] as any[];
		runConcurrentFunctionsMock.mockResolvedValueOnce([[], [new Error('fail'), new Error('x')]]);

		await deleteFilteredTorrents(torrents, () => vi.fn(async () => ''));

		expect(toast.error).toHaveBeenCalledWith(
			'Failed to delete 2 torrents.',
			expect.objectContaining({ id: 'toast-id' })
		);
	});

	it('dismisses the progress toast when no action occurs', async () => {
		const torrents = [{ id: 'a' }] as any[];
		runConcurrentFunctionsMock.mockResolvedValueOnce([[], []]);

		await deleteFilteredTorrents(torrents, () => vi.fn(async () => ''));

		expect(toast.dismiss).toHaveBeenCalledWith('toast-id');
	});
});
