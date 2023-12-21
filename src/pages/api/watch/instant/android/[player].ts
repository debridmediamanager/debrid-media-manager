import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import { handleSelectFilesInRd } from '@/utils/addMagnet';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { player, token, hash } = req.query;
	const rdKey = token as string;
	const id = await addHashAsMagnet(rdKey, hash as string, true);
	await handleSelectFilesInRd(rdKey, `rd:${id}`, true);
	const torrent = await getTorrentInfo(rdKey, id, true);
	// get biggest file index
	const biggestFile = torrent.files.reduce((prev, current) => {
		return prev.bytes > current.bytes ? prev : current;
	});
	const biggestFileIdx = torrent.files.findIndex((f) => f.id === biggestFile.id);
	const link = torrent.links[biggestFileIdx] ?? torrent.links[0];
	const resp = await unrestrictLink(
		rdKey as string,
		link,
		(req.headers['​​CF-Connecting-IP'] as string) ?? req.socket.remoteAddress,
		true
	);
	await deleteTorrent(rdKey, id, true);
	res.redirect(
		307,
		`intent://${resp.download.replace(
			'https://',
			''
		)}#Intent;type=video/any;scheme=https;package=${player};end`
	);
};

export default handler;
