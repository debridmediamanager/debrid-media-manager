import { castEasynewsFile } from '@/utils/easynewsCastSave';
import type { NextApiRequest, NextApiResponse } from 'next';

// EPISODE cast: one Easynews file, kept under `imdbid:season:episode` from its name.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
	return castEasynewsFile(req, res, 'show');
}
