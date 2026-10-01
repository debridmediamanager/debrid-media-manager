// pages/api/shorturl.ts
import {
	HASHLIST_APP_URL,
	HASHLIST_HOST,
	hashlistDataPath,
	hashlistFragmentForId,
	hashlistPageHtml,
	isLzUriSafe,
} from '@/utils/hashlistSource';
import { Octokit } from '@octokit/rest';
import lzString from 'lz-string';
import { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';

const OWNER = 'debridmediamanager';
const REPO = 'hashlists';
const REF = 'heads/main';

export const config = {
	api: {
		bodyParser: {
			sizeLimit: '100mb',
		},
	},
};

// Whether `data` is lz-string text that decodes to a hash list: an object
// with a `torrents` array, or the bare array a single-torrent share carries.
function isHashlistData(data: unknown): data is string {
	if (typeof data !== 'string' || !isLzUriSafe(data)) return false;
	try {
		const parsed = JSON.parse(lzString.decompressFromEncodedURIComponent(data) ?? '');
		return Array.isArray(parsed) || Array.isArray(parsed?.torrents);
	} catch {
		return false;
	}
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.status(405).json({ message: 'Method not allowed' });
		return;
	}
	// `data` is the list itself, stored beside its page (see hashlistSource).
	// `url` is the old form, the whole list in the iframe URL, still accepted
	// from pages loaded before that change.
	const { url, data } = req.body ?? {};

	if (data !== undefined && !isHashlistData(data)) {
		res.status(400).json({ message: 'data must be an lz-string encoded hash list' });
		return;
	}
	if (data === undefined && !url) {
		res.status(400).json({ message: 'URL is required' });
		return;
	}

	const uuid = uuidv4();
	const iframeSrc =
		data === undefined ? url : `${HASHLIST_APP_URL}#${hashlistFragmentForId(uuid)}`;

	const token = process.env.GH_PAT;

	try {
		const octokit = new Octokit({ auth: token });

		// Get reference to the latest commit in the main branch
		const { data: refData } = await octokit.rest.git.getRef({
			owner: OWNER,
			repo: REPO,
			ref: REF,
		});

		const files: { path: string; content: string }[] = [
			{ path: `${uuid}.html`, content: hashlistPageHtml(iframeSrc) },
		];
		if (data !== undefined) files.push({ path: hashlistDataPath(uuid), content: data });

		// Create the blobs, then one tree and one commit holding all of them
		const blobs = await Promise.all(
			files.map((file) =>
				octokit.rest.git.createBlob({
					owner: OWNER,
					repo: REPO,
					content: file.content,
					encoding: 'utf-8',
				})
			)
		);

		const { data: treeData } = await octokit.rest.git.createTree({
			owner: OWNER,
			repo: REPO,
			base_tree: refData.object.sha,
			tree: files.map((file, i) => ({
				path: file.path,
				mode: '100644' as const,
				type: 'blob' as const,
				sha: blobs[i].data.sha,
			})),
		});

		// Create a new commit
		const { data: commitData } = await octokit.rest.git.createCommit({
			owner: OWNER,
			repo: REPO,
			message: `${uuid}`,
			tree: treeData.sha,
			parents: [refData.object.sha],
		});

		// Update the reference to point to the new commit
		await octokit.rest.git.updateRef({
			owner: OWNER,
			repo: REPO,
			ref: 'heads/main',
			sha: commitData.sha,
		});

		res.status(200).json({ shortUrl: `${HASHLIST_HOST}/${uuid}.html` });
	} catch (error) {
		console.error(error);
		res.status(500).send('Error adding file to GitHub repository');
	}
}
