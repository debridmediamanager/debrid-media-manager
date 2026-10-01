import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteHashlistPages } from './hashlists';

const git = vi.hoisted(() => ({
	getRef: vi.fn(),
	getCommit: vi.fn(),
	getTree: vi.fn(),
	createTree: vi.fn(),
	createCommit: vi.fn(),
	updateRef: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation(() => ({ rest: { git } })),
}));

const OLD = '11111111-1111-4111-8111-111111111111';
const STORED = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';

describe('deleteHashlistPages', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		git.getRef.mockResolvedValue({ data: { object: { sha: 'head' } } });
		git.getCommit.mockResolvedValue({ data: { tree: { sha: 'root' } } });
		git.getTree.mockImplementation(async ({ tree_sha }: { tree_sha: string }) =>
			tree_sha === 'root'
				? {
						data: {
							tree: [
								{ path: `${OLD}.html`, type: 'blob' },
								{ path: `${STORED}.html`, type: 'blob' },
								{ path: 'lists', type: 'tree', sha: 'lists-sha' },
							],
						},
					}
				: { data: { tree: [{ path: `${STORED}.txt`, type: 'blob' }] } }
		);
		git.createTree.mockResolvedValue({ data: { sha: 'new-tree' } });
		git.createCommit.mockResolvedValue({ data: { sha: 'new-commit' } });
	});

	// A list stored beside its page would otherwise outlive the takedown,
	// still fetchable at hashlists.debridmediamanager.com/lists/<id>.txt.
	it('removes a stored list together with its page, in one commit', async () => {
		const result = await deleteHashlistPages([OLD, STORED, GONE], 'n1');

		expect(result).toEqual({ deleted: [OLD, STORED], missing: [GONE] });
		expect(git.createTree).toHaveBeenCalledTimes(1);
		expect(git.createTree.mock.calls[0][0].tree.map((e: { path: string }) => e.path)).toEqual([
			`${OLD}.html`,
			`${STORED}.html`,
			`lists/${STORED}.txt`,
		]);
		expect(
			git.createTree.mock.calls[0][0].tree.every((e: { sha: null }) => e.sha === null)
		).toBe(true);
		expect(git.createCommit).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'remove: takedown notice n1', parents: ['head'] })
		);
		expect(git.updateRef).toHaveBeenCalledWith(
			expect.objectContaining({ ref: 'heads/main', sha: 'new-commit' })
		);
	});

	it('commits nothing when none of the ids are there', async () => {
		expect(await deleteHashlistPages([GONE], 'n2')).toEqual({ deleted: [], missing: [GONE] });
		expect(git.createTree).not.toHaveBeenCalled();
	});

	it('works on a repository with no lists directory yet', async () => {
		git.getTree.mockResolvedValue({ data: { tree: [{ path: `${OLD}.html`, type: 'blob' }] } });
		expect(await deleteHashlistPages([OLD], 'n3')).toEqual({ deleted: [OLD], missing: [] });
		expect(git.getTree).toHaveBeenCalledTimes(1);
	});
});
