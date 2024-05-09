import { getTorrentInfo, unrestrictLink } from '@/services/realDebrid';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { token, torrentId } = req.query;
	const rdKey = token as string;
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const [filename, downloadLinks] = await exportDownloadLinks(
		rdKey,
		torrentId as string,
		ipAddress,
	);
	if (downloadLinks) {
		res.setHeader('Content-Disposition', `attachment; filename=${filename}-links.txt`);
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(downloadLinks);
	} else {
		res.status(500).send('Internal Server Error');
	}
};

export default handler;

export const exportDownloadLinks = async (
	rdKey: string,
	torrentId: string,
	ipAddress: string
) => {
	let filename = '', intent = '';
	try {
        const info = await getTorrentInfo(rdKey, torrentId, true);
        filename = info.original_filename;
		for (const link of info.links) {
            try {
                const resp = await unrestrictLink(rdKey, link, ipAddress, true);
                intent += resp.download + '\n';
            } catch (e) {
                console.log('exportdownload, unrestrict error', e);
            }
        }
	} catch (e) {
		console.log('exportdownload, getinfo error', e);
	}
	return [filename, intent];
};
