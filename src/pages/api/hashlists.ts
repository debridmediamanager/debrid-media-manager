// pages/api/shorturl.ts
import { Octokit } from '@octokit/rest';
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.status(405).json({ message: 'Method not allowed' });
	}
	// Generate short URL for the given URL
	const { url } = req.body;

	if (!url) {
		res.status(400).json({ message: 'URL is required' });
		return;
	}

	const uuid = uuidv4();

	const token = process.env.GH_PAT;

	try {
		const octokit = new Octokit({ auth: token });

		// Get reference to the latest commit in the main branch
		const { data: refData } = await octokit.rest.git.getRef({
			owner: OWNER,
			repo: REPO,
			ref: REF,
		});

		// Create a new blob with the file content
		const { data: blobData } = await octokit.rest.git.createBlob({
			owner: OWNER,
			repo: REPO,
			content: `<!doctype html>
<html>
<head>
<meta charset=UTF-8>
<title>Debrid Media Manager Hash List</title>
<style>iframe{border:none;position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head>
<body>
<iframe src="${url}"></iframe>
</body>
</html>`,
			encoding: 'utf-8',
		});

		// Create a new tree with the new file
		const { data: treeData } = await octokit.rest.git.createTree({
			owner: OWNER,
			repo: REPO,
			base_tree: refData.object.sha,
			tree: [
				{
					path: `${uuid}.html`,
					mode: '100644',
					type: 'blob',
					sha: blobData.sha,
				},
			],
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

		res.status(200).json({ shortUrl: `https://hashlists.debridmediamanager.com/${uuid}.html` });
	} catch (error) {
		console.error(error);
		res.status(500).send('Error adding file to GitHub repository');
	}
}
