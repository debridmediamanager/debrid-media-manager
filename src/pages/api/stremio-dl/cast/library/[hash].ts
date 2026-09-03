import { repository as db } from '@/services/repository';
import { planLibraryCast } from '@/utils/castLibraryPlan';
import {
	describeDebridLinkError,
	generateDebridLinkUserId,
	resolveDebridLinkRelease,
	resolveDebridLinkTorrentById,
} from '@/utils/debridLinkCastApiHelpers';
import { type DebridLinkVideoFile } from '@/utils/debridLinkCastFiles';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { NextApiRequest, NextApiResponse } from 'next';

// Casts every video in a library item to Stremio.
//
// `torrentId` is preferred over the hash and is not merely an optimisation:
// `seedbox/list?ids=<id>` returns the release's whole file list with a live
// download URL per file and **costs no quota**, while resolving by hash means
// `POST /seedbox/add`, which spends one of the 50 daily torrents whenever the
// content is not already in the account. Casting something the user is looking
// at in their own library should never cost them a torrent. It is also the ZIP
// escape hatch - a many-file torrent lists as one `isZip: true` row in the bulk
// listing and only expands when fetched on its own.
//
// The hash stays the address of the *cast*, though, because play resolves by
// hash with the viewer's credential: nothing about a cast depends on the
// release still sitting in the caster's seedbox.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { hash, imdbId: userProvidedImdbId, torrentId } = req.query;
	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid Debrid-Link token',
		});
		return;
	}

	if (typeof hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(hash)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid info hash',
		});
		return;
	}

	try {
		let files: DebridLinkVideoFile[] = [];

		if (typeof torrentId === 'string' && torrentId) {
			try {
				const held = await resolveDebridLinkTorrentById(apiKey, torrentId);
				if (held) files = held.files;
			} catch (error) {
				// Falls through to the hash resolve below, which costs quota but
				// at least answers.
				console.error('Debrid-Link listing by id failed:', describeDebridLinkError(error));
			}
		}

		if (files.length === 0) {
			const release = await resolveDebridLinkRelease(apiKey, hash);
			if (!release.finished) {
				res.status(409).json({
					status: 'error',
					errorMessage: `Debrid-Link is still downloading this release (${release.percent}%) - cast it again once it finishes`,
				});
				return;
			}
			files = release.files;
		}

		if (files.length === 0) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'No video files found in this release',
			});
			return;
		}

		let userid: string;
		try {
			userid = await generateDebridLinkUserId(apiKey);
		} catch (error) {
			console.error('Failed to generate Debrid-Link user ID');
			res.status(500).json({
				status: 'error',
				errorMessage: 'Failed to generate user ID from Debrid-Link token',
			});
			return;
		}

		let imdbid = '';
		try {
			imdbid = (await db.getIMDBIdByHash(hash)) || '';
		} catch (error) {
			console.error('Failed to retrieve IMDB ID from database:', error);
			res.status(500).json({
				status: 'error',
				errorMessage: 'Database error: Failed to retrieve IMDB ID from hash',
			});
			return;
		}

		if (!imdbid && typeof userProvidedImdbId === 'string' && userProvidedImdbId) {
			if (!/^tt\d{7,}$/.test(userProvidedImdbId)) {
				res.status(400).json({
					status: 'error',
					errorMessage: 'Invalid IMDB ID format. Expected format: tt1234567',
				});
				return;
			}
			try {
				await db.saveIMDBIdMapping(hash, userProvidedImdbId);
				imdbid = userProvidedImdbId;
			} catch (error) {
				console.error('Failed to save IMDB ID mapping:', error);
				res.status(500).json({
					status: 'error',
					errorMessage: 'Database error: Failed to save IMDB ID mapping',
				});
				return;
			}
		}

		if (!imdbid) {
			res.status(200).json({
				status: 'need_imdb_id',
				torrentInfo: {
					title: files[0].filename,
					filename: files[0].filename,
					hash,
					files: files.map((file) => ({ path: file.path, bytes: file.size })),
				},
			});
			return;
		}

		const plan = planLibraryCast(imdbid, files, (file) => ({
			filename: file.filename,
			size: file.size,
		}));

		for (const { file, stremioKey } of plan) {
			await db.saveDebridLinkCast(
				stremioKey,
				userid,
				hash,
				file.filename,
				Math.round(file.size / 1024 / 1024),
				file.path,
				file.link ?? undefined
			);
		}

		const season = plan[0]?.season != null ? String(plan[0].season) : '';
		const episode = plan[0]?.episode != null ? String(plan[0].episode) : '';

		res.status(200).json({
			status: 'success',
			redirectUrl:
				season && episode
					? getStremioDetailUrl(imdbid, { season, episode })
					: getStremioDetailUrl(imdbid),
			imdbId: imdbid,
			mediaType: season && episode ? 'series' : 'movie',
			season: season || undefined,
			episode: episode || undefined,
		});
	} catch (error) {
		const message = describeDebridLinkError(error);
		console.error('Debrid-Link library cast error:', message);
		res.status(500).json({ status: 'error', errorMessage: message });
	}
}
