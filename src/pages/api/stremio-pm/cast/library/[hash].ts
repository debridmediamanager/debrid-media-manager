import { directDownloadPremiumize } from '@/services/premiumize';
import { repository as db } from '@/services/repository';
import { planLibraryCast } from '@/utils/castLibraryPlan';
import { generatePremiumizeUserId } from '@/utils/premiumizeCastApiHelpers';
import { premiumizeVideoFiles } from '@/utils/premiumizeCastFiles';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { NextApiRequest, NextApiResponse } from 'next';

// Casts every video in a library item to Stremio.
//
// The hash is the whole address here, where the other three providers need an
// account-scoped id beside it: `transfer/directdl` resolves a hash to its files
// in one stateless call, so nothing about this depends on the release still
// sitting in the caster's cloud. That is also why the route stores no link -
// the viewer mints their own at play time, on their own key and their own
// bandwidth.
//
// The flip side is that a Premiumize row whose transfer record was cleared
// reports no info hash at all, and cannot be cast. The modal hides the button
// for those rather than offering one that cannot work.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { hash, imdbId: userProvidedImdbId } = req.query;
	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid Premiumize API key',
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
		const files = premiumizeVideoFiles(await directDownloadPremiumize(apiKey, hash));
		if (files.length === 0) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'No video files found in this release',
			});
			return;
		}

		let userid: string;
		try {
			userid = await generatePremiumizeUserId(apiKey);
		} catch (error) {
			console.error('Failed to generate Premiumize user ID:', error);
			res.status(500).json({
				status: 'error',
				errorMessage: 'Failed to generate user ID from Premiumize API key',
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
			await db.savePremiumizeCast(
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
		console.error('Premiumize library cast error:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Internal server error',
		});
	}
}
