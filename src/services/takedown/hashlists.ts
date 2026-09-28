import { Octokit } from '@octokit/rest';

const OWNER = 'debridmediamanager';
const REPO = 'hashlists';

/**
 * Deletes shared hash list pages from the repository that serves
 * hashlists.debridmediamanager.com, in one commit. Ids that are not there are
 * skipped, so re-approving a notice is harmless.
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
	const deleted = ids.filter((id) => present.has(`${id}.html`));
	const missing = ids.filter((id) => !present.has(`${id}.html`));
	if (deleted.length === 0) return { deleted, missing };

	const { data: newTree } = await octokit.rest.git.createTree({
		owner: OWNER,
		repo: REPO,
		base_tree: commit.tree.sha,
		tree: deleted.map((id) => ({
			path: `${id}.html`,
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
