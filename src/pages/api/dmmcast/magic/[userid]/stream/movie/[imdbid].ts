import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, imdbid } = req.query;
	const imdbidStr = imdbid as string;
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		streams: [
			{
				name: 'Cast✨',
				title: 'Choose a Torrent > Watch > Cast',
				externalUrl: `${process.env.DMM_ORIGIN}/movie/${imdbidStr.replace(/\.json$/, '')}`,
			},
			{
				name: 'Stream🪄',
				title: 'Stream the link you casted',
				url: `${
					process.env.DMM_ORIGIN
				}/api/dmmcast/magic/${userid}/watch/${imdbidStr.replace(/\.json$/, '')}/ping`,
			},
		],
	});
}
