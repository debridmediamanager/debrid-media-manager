import {
	EasynewsAuthError,
	EasynewsGoneError,
	isEasynewsPath,
	resolveEasynewsLink,
	splitEasynewsPath,
} from '@/services/easynews';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';
import { easynewsCastUserId } from './easynewsCastApiHelpers';
import { easynewsCredentialsOf } from './easynewsCastKey';
import { readBearerKey } from './providerKeyHeader';

/**
 * Casts one Easynews result: a film under its IMDb id, an episode under
 * `imdbid:season:episode`. Easynews lists files, not releases, so a cast is one
 * file and there is nothing to pick inside it. The file is asked for once with
 * the caster's login before it is kept, which checks the login and that
 * Easynews can still serve the file.
 */
export async function castEasynewsFile(
	req: NextApiRequest,
	res: NextApiResponse,
	kind: 'movie' | 'show'
) {
	res.setHeader('access-control-allow-origin', '*');
	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		return res.status(405).end(`Method ${req.method} Not Allowed`);
	}

	const credentials = easynewsCredentialsOf(readBearerKey(req));
	if (!credentials) {
		return res
			.status(400)
			.json({ status: 'error', errorMessage: 'Missing or invalid Easynews key' });
	}
	const { imdbid } = req.query;
	const { path, size } = req.body ?? {};
	if (typeof imdbid !== 'string' || !/^tt\d{7,}$/.test(imdbid) || !isEasynewsPath(path)) {
		return res
			.status(400)
			.json({ status: 'error', errorMessage: 'Invalid "imdbid" or Easynews "path"' });
	}
	const bytes = Number(size);
	if (!Number.isFinite(bytes) || bytes < 0) {
		return res.status(400).json({ status: 'error', errorMessage: 'Invalid "size"' });
	}

	const { hash, name, ext } = splitEasynewsPath(path);
	const filename = `${name}${ext}`;
	let key = imdbid;
	if (kind === 'show') {
		// A multi-episode file is filed under its first episode, as Send to zurg does.
		const info = ptt.parse(name);
		if (info.season == null || info.episode == null) {
			return res.status(422).json({
				status: 'error',
				errorMessage: `${filename} has no episode number in its name`,
			});
		}
		key = `${imdbid}:${info.season}:${info.episode}`;
	}

	try {
		await resolveEasynewsLink(credentials, path);
	} catch (error) {
		if (error instanceof EasynewsAuthError) {
			return res.status(401).json({ status: 'error', errorMessage: error.message });
		}
		if (error instanceof EasynewsGoneError) {
			return res.status(410).json({ status: 'error', errorMessage: error.message });
		}
		console.error(
			'Easynews cast failed:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return res
			.status(502)
			.json({ status: 'error', errorMessage: 'Easynews did not hand out this file' });
	}

	try {
		await db.saveEasynewsCast(
			key,
			easynewsCastUserId(credentials.username),
			hash,
			filename,
			Math.round(bytes / 1024 / 1024),
			path
		);
	} catch (error) {
		console.error('Saving Easynews cast failed:', error);
		return res.status(500).json({ status: 'error', errorMessage: 'Could not save the cast' });
	}
	return res.status(200).json({ status: 'success', filename, key });
}
