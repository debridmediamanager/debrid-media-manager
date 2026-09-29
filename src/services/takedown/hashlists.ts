import { hashlistDataPath } from '@/utils/hashlistSource';
import { Octokit } from '@octokit/rest';

const OWNER = 'debridmediamanager';
const REPO = 'hashlists';

/**
 * Deletes shared hash list pages from the repository that serves
 * hashlists.debridmediamanager.com, in one commit, together with the list
 * each one stores under `lists/` (see hashlistSource). Ids that are not there
 * are skipped, so re-approving a notice is harmless.
 */
export async function deleteHashlistPages(
	ids: string[],
	noticeId: string
): Promise<{ deleted: string[]; missing: string[] }> {
	if (ids.length === 0) return { deleted: [], missing: [] };
	const octokit = new Octokit({ auth: process.env.GH_PAT });
	const { data: ref } = await octokit.rest.git.getRef({
		owner: OWNER,
		repo: REPO,
		ref: 'heads/main',
	});
	const { data: commit } = await octokit.rest.git.getCommit({
		owner: OWNER,
		repo: REPO,
		commit_sha: ref.object.sha,
	});
	const { data: tree } = await octokit.rest.git.getTree({
		owner: OWNER,
		repo: REPO,
		tree_sha: commit.tree.sha,
	});
	const present = new Set(tree.tree.map((entry) => entry.path));
	// The root tree lists `lists` as one entry; its files are one level down.
	const listsTree = tree.tree.find((entry) => entry.path === 'lists' && entry.type === 'tree');
	if (listsTree?.sha) {
		const { data: lists } = await octokit.rest.git.getTree({
			owner: OWNER,
			repo: REPO,
			tree_sha: listsTree.sha,
		});
		for (const entry of lists.tree) present.add(`lists/${entry.path}`);
	}
	const pathsOf = (id: string) =>
		[`${id}.html`, hashlistDataPath(id)].filter((path) => present.has(path));
	const deleted = ids.filter((id) => pathsOf(id).length > 0);
	const missing = ids.filter((id) => pathsOf(id).length === 0);
	if (deleted.length === 0) return { deleted, missing };

	const { data: newTree } = await octokit.rest.git.createTree({
		owner: OWNER,
		repo: REPO,
		base_tree: commit.tree.sha,
		tree: deleted.flatMap(pathsOf).map((path) => ({
			path,
			mode: '100644' as const,
			type: 'blob' as const,
			sha: null,
		})),
	});
	const { data: newCommit } = await octokit.rest.git.createCommit({
		owner: OWNER,
		repo: REPO,
		message: `remove: takedown notice ${noticeId}`,
		tree: newTree.sha,
		parents: [ref.object.sha],
	});
	await octokit.rest.git.updateRef({
		owner: OWNER,
		repo: REPO,
		ref: 'heads/main',
		sha: newCommit.sha,
	});
	return { deleted, missing };
}
