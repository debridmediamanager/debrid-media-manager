import { exploreOffcloudCloud, joinExploreWithCacheInfo } from '@/services/offcloud';
import { repository as db } from '@/services/repository';
import { planLibraryCast } from '@/utils/castLibraryPlan';
import { generateOffcloudUserId, resolveCachedOffcloudFiles } from '@/utils/offcloudCastApiHelpers';
import { offcloudVideoFiles, type OffcloudVideoFile } from '@/utils/offcloudCastFiles';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { NextApiRequest, NextApiResponse } from 'next';

// Casts every video in a library item to Stremio.
//
// The hash is the address, not the row id: play resolves by hash with the
// *viewer's* key, so nothing about a cast depends on the release still sitting
// in the caster's cloud. `cache/info` lists the files statelessly, which is why
// this route adds nothing and stores no link.
//
// `requestId` is an optional fallback for the one case `cache/info` cannot
// answer: an item Offcloud downloaded for this account but does not hold in the
// shared cache reads `cached: false` with no files. `cloud/explore` on the
// caller's own item still lists it, so the row stays castable for its owner -
// who is also the only person a hash Offcloud has not cached could ever play it
// for.
//
// A row created from a plain HTTP submission reports no info hash at all and
// cannot be cast; the library hides the button for those rather than offering
// one that cannot work.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { hash, imdbId: userProvidedImdbId, requestId } = req.query;
	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid Offcloud API key',
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
		let files: OffcloudVideoFile[] = await resolveCachedOffcloudFiles(apiKey, hash);

		if (files.length === 0 && typeof requestId === 'string' && requestId) {
			try {
				const links = await exploreOffcloudCloud(apiKey, requestId);
				// No `cache/info` companion here - it is what just came back
				// empty - so these files carry basenames and no sizes.
				files = offcloudVideoFiles(joinExploreWithCacheInfo(links, []));
			} catch (error) {
				console.error(
					'Offcloud explore fallback failed:',
					error instanceof Error ? error.message : 'Unknown error'
				);
			}
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
			userid = await generateOffcloudUserId(apiKey);
		} catch (error) {
			console.error('Failed to generate Offcloud user ID');
			res.status(500).json({
				status: 'error',
				errorMessage: 'Failed to generate user ID from Offcloud API key',
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
			await db.saveOffcloudCast(
				stremioKey,
				userid,
				hash,
				file.filename,
				Math.round(file.size / 1024 / 1024),
				file.path
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
		console.error(
			'Offcloud library cast error:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Internal server error',
		});
	}
}
