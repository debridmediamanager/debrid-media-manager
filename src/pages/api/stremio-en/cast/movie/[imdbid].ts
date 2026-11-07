import { castEasynewsFile } from '@/utils/easynewsCastSave';
import type { NextApiRequest, NextApiResponse } from 'next';

// MOVIE cast: one Easynews file, kept under the film's IMDb id.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
	return castEasynewsFile(req, res, 'movie');
}
