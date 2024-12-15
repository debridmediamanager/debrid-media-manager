import { getTorrentInfo, unrestrictLink } from '@/services/realDebrid';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { token, torrentId } = req.query;
	const rdKey = token as string;
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const [filename, downloadLinks] = await exportDownloadLinks(
		rdKey,
		torrentId as string,
		ipAddress
	);
	if (downloadLinks) {
		res.setHeader('Content-Disposition', `attachment; filename=${filename}-links.txt`);
		res.setHeader('Content-Type', 'text/plain');
		res.status(200).send(downloadLinks);
	} else {
		res.status(500).json({ error: `No download links found for torrent ${torrentId}` });
	}
};

export default handler;

export const exportDownloadLinks = async (rdKey: string, torrentId: string, ipAddress: string) => {
	let filename = '',
		downloadLinks = '';
	try {
		const info = await getTorrentInfo(rdKey, torrentId, true);
		filename = info.original_filename;
		for (const link of info.links) {
			try {
				const resp = await unrestrictLink(rdKey, link, ipAddress, true);
				downloadLinks += resp.download + '\n';
			} catch (e) {
				console.error('exportdownload, unrestrict error', e);
			}
		}
	} catch (e) {
		console.error('exportdownload, gettorrentinfo error', e);
	}
	return [filename, downloadLinks];
};
