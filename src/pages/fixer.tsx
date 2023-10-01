import { useRealDebridAccessToken } from '@/hooks/auth';
import {
	DownloadResponse,
	UnrestrictResponse,
	UserTorrentResponse,
	addHashAsMagnet,
	deleteDownload,
	deleteTorrent,
	getDownloads,
	getTorrentInfo,
	getUserTorrentsList,
	selectFiles,
	unrestrictLink,
} from '@/services/realDebrid';
import { getSelectableFiles, isVideoOrSubs } from '@/utils/selectable';
import { withAuth } from '@/utils/withAuth';
import { useEffect, useState } from 'react';

let rdTorrents: UserTorrentResponse[] = [];
let rdDownloads: DownloadResponse[] = [];

async function downloadFirstByte(url: string): Promise<number> {
	const controller = new AbortController();
	const signal = controller.signal;
	try {
		const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
		const reader = response.body?.getReader();
		if (!reader) return 500;
		await reader.read();
		controller.abort();
		return response.status;
	} catch (error) {
		controller.abort();
		return 600;
	}
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function FixerPage() {
	// keys
	const rdKey = useRealDebridAccessToken();

	const [fixOutput, setFixOutput] = useState('Running fixes...\n-----\n');
	const [fixRunning, setFixRunning] = useState(false);

	useEffect(() => {
		if (!fixRunning) return;
		window.onbeforeunload = function (e) {
			e = e || window.event;
			if (e) {
				e.returnValue = 'Sure?';
			}
			return 'Sure?';
		};
	}, [fixRunning]);

	const refreshData = async () => {
		rdTorrents = await getUserTorrentsList(rdKey!);
		setFixOutput(
			(prev) => prev + `RD torrent count: ${rdTorrents.length}\nFetching downloads...\n`
		);
		rdDownloads = await getDownloads(rdKey!);
		setFixOutput((prev) => prev + `RD download count: ${rdDownloads.length}\n`);
	};

	const processBatch = async (
		batch: DownloadResponse[] | UnrestrictResponse[],
		previousLink?: string
	) => {
		const promises = batch.map(async (item) => {
			let downloadLink = item.download;
			try {
				const downloadStatus = await downloadFirstByte(
					`https://corsproxy.org/?${downloadLink}`
				);
				if (downloadStatus > 300) {
					setFixOutput(
						(prev) =>
							prev +
							`E${!!previousLink ? '2' : ''}(${downloadStatus}): ${
								item.filename
							} # ${downloadLink}\n`
					);
					await deleteDownload(rdKey!, item.id);
					if (!previousLink) {
						// try to re-unrestrict the same link
						const unrestrictedDownload = await unrestrictLink(rdKey!, item.link);
						await processBatch([unrestrictedDownload], downloadLink);
					} else {
						const badTorrent = rdTorrents.find((t) => t.links.includes(item.link));
						if (badTorrent) await fixBadTorrent(badTorrent);
					}
				}
			} catch (e) {
				setFixOutput(
					(prev) =>
						prev +
						`E${!!previousLink ? '2' : ''}(${e}): ${item.filename} # ${downloadLink}\n`
				);
				await deleteDownload(rdKey!, item.id);
				if (!previousLink) {
					const unrestrictedDownload = await unrestrictLink(rdKey!, item.link);
					await processBatch([unrestrictedDownload], downloadLink);
				} else {
					const badTorrent = rdTorrents.find((t) => t.links.includes(item.link));
					if (badTorrent) await fixBadTorrent(badTorrent);
				}
			}
		});
		await Promise.all(promises);
	};

	const fixBadTorrent = async (badTorrent: { id: string; filename: string; hash: string }) => {
		setFixOutput(
			(prev) =>
				prev +
				`\nBad torrent procedure\nRedownloading bad torrent: ${badTorrent.filename}\n`
		);
		const hash = badTorrent.hash;
		const id = await addHashAsMagnet(rdKey!, hash);
		let response = await getTorrentInfo(rdKey!, id);
		const selectedFiles = getSelectableFiles(response.files.filter(isVideoOrSubs)).map(
			(file) => file.id
		);
		if (selectedFiles.length === 0) {
			setFixOutput((prev) => prev + `Error: no file for selection\n`);
		} else {
			await selectFiles(rdKey!, id, selectedFiles);
		}
		response = await getTorrentInfo(rdKey!, id);
		setFixOutput((prev) => prev + `Unrestricting new links (${response.links.length})...\n`);
		for (let i = 0; i < response.links.length; i++) {
			try {
				const link = response.links[i];
				const unrestrictedLink = await unrestrictLink(rdKey!, link);
				if (!unrestrictedLink.streamable && response.links.length === 1)
					throw new Error('Unstreamable');
			} catch (e) {
				setFixOutput((prev) => prev + `No hope here: ${e}\n`);
				setFixOutput((prev) => prev + `Filename: ${response.filename}\n`);
				setFixOutput((prev) => prev + `Hash: ${response.hash}\n`);
				setFixOutput((prev) => prev + `Deleting new torrent...\n`);
				await deleteTorrent(rdKey!, response.id);
			}
		}
		setFixOutput((prev) => prev + `Deleting old torrent...\n`);
		await deleteTorrent(rdKey!, badTorrent.id);
		setFixOutput((prev) => prev + `Bad torrent removed\n`);
	};

	const startTest = async () => {
		if (rdKey) {
			try {
				if (
					!confirm(
						`This is an expensive DMM+Real-Debrid server operation so please use it sparingly`
					)
				)
					return;
				if (
					!confirm(
						`This assumes your Real-Debrid account is used exclusively for media downloads. Take caution as this will delete all non-media downloads`
					)
				)
					return;
				if (
					!confirm(
						`It comes in 4 phases:\n1. Delete unstreamable content\n2. Delete duplicate downloads\n3. Unrestrict yet to be unrestricted torrents\n4. Delete deleted content in RD servers\nYou will be asked to proceed on each phase\n\nProceed to Phase 1?`
					)
				)
					return;
				setFixRunning(true);

				/// PHASE 1: NON STREAMABLE CONTENT
				setFixOutput((prev) => prev + `PHASE 1 PREPARATION\n`);
				await refreshData();
				let unstreamable = rdDownloads.filter((d) => !d.streamable);
				setFixOutput((prev) => prev + `Fixing unstreamable content\n`);
				for (let i = 0; i < unstreamable.length; i++) {
					let link = unstreamable[i].link;
					setFixOutput(
						(prev) => prev + `Identified: ${unstreamable[i].filename}\nDeleting...`
					);

					await deleteDownload(rdKey!, unstreamable[i].id);
					setFixOutput((prev) => prev + `Removed unstreamable download\n`);

					const badTorrent = rdTorrents.find((t) => t.links.includes(link));
					if (!badTorrent) continue;
					await fixBadTorrent(badTorrent);
				}
				setFixOutput((prev) => prev + `PHASE 1 DONE!\n\n`);

				// PHASE 2: DELETE DUPLICATE DOWNLOADS
				setFixOutput((prev) => prev + `PHASE 2 PREPARATION\n`);
				await refreshData();
				let dupeDownloads: DownloadResponse[] = [];
				rdDownloads.reduce(
					(acc: { [key: string]: DownloadResponse }, cur: DownloadResponse) => {
						let key = `${cur.filename}_${cur.filesize}`;
						if (acc[key]) {
							const torrent1 = rdTorrents.find((t) =>
								t.links.includes(acc[key].link)
							);
							if (!torrent1) return acc;
							const torrent2 = rdTorrents.find((t) => t.links.includes(cur.link));
							if (!torrent2) return acc;
							if (
								torrent1.filename === torrent2.filename ||
								torrent1.bytes === torrent2.bytes ||
								torrent1.hash === torrent2.hash
							)
								dupeDownloads.push(cur);
						} else if (!acc[key]) {
							acc[key] = cur;
						}
						return acc;
					},
					{}
				);
				if (
					!confirm(
						`This will delete ${
							dupeDownloads.length
						} duplicate links and will take approx ${Math.ceil(
							(dupeDownloads.length / 600) * 1.3
						)} minutes. Proceed?`
					)
				)
					return;
				setFixOutput(
					(prev) =>
						prev +
						`Found ${dupeDownloads.length} duplicate links to delete, processing\n`
				);
				for (let i = 0; i < dupeDownloads.length; i += 1) {
					try {
						await deleteDownload(rdKey!, dupeDownloads[i].id);
						delay(100);
					} catch (e: any) {
						if (e.response?.status === 429) {
							await delay(1000);
						} else {
							await delay(250);
						}
					}
					setFixOutput((prev) => prev + `.`);
					if (i % 40 === 0 && i > 0)
						setFixOutput(
							(prev) => prev + `(${Math.ceil((i / dupeDownloads.length) * 100)}%)\n`
						);
				}
				setFixOutput((prev) => prev + `PHASE 2 DONE!\n\n`);

				/// PHASE 3: YET TO BE UNRESTRICTED TORRENTS
				setFixOutput((prev) => prev + `PHASE 3 PREPARATION\n`);
				await refreshData();
				const unrestricted = rdTorrents
					.map((t) => t.links)
					.flat()
					.filter((l) => !rdDownloads.find((d) => d.link === l));
				if (
					!confirm(
						`This will unrestrict ${
							unrestricted.length
						} links and will take approx ${Math.ceil(
							(unrestricted.length / 300) * 1.3
						)} minutes. Proceed?`
					)
				)
					return;
				setFixOutput(
					(prev) =>
						prev + `Found ${unrestricted.length} links to unrestrict, processing\n`
				);
				for (let i = 0; i < unrestricted.length; i += 1) {
					const rdLink = unrestricted[i];
					try {
						await unrestrictLink(rdKey!, rdLink);
						await delay(200);
					} catch (e: any) {
						if (e.response?.status === 429) {
							await delay(1000);
						} else {
							// find rd torrent and delete it
							const suspectedBad = rdTorrents.find((t) => t.links.includes(rdLink));
							if (!suspectedBad) {
								continue;
							}
							setFixOutput(
								(prev) =>
									prev + `Not all files are playable: ${suspectedBad.filename}\n`
							);
							// remove from list of links
							suspectedBad.links = suspectedBad?.links.splice(
								suspectedBad.links.findIndex((l) => l === rdLink),
								1
							);
							await delay(250);
						}
					}
					setFixOutput((prev) => prev + `.`);
					if (i % 40 === 0 && i > 0)
						setFixOutput(
							(prev) => prev + `(${Math.ceil((i / unrestricted.length) * 100)}%)\n`
						);
				}
				// delete torrents with no links
				const badTorrents = rdTorrents.filter((t) => t.links.length === 0);
				setFixOutput((prev) => prev + `Deleting ${badTorrents.length} bad torrents\n`);
				for (let i = 0; i < badTorrents.length; i += 1) {
					await deleteTorrent(rdKey!, badTorrents[i].id);
					setFixOutput((prev) => prev + `.`);
					if (i % 40 === 0 && i > 0)
						setFixOutput(
							(prev) => prev + `(${Math.ceil((i / badTorrents.length) * 100)}%)\n`
						);
				}
				setFixOutput((prev) => prev + `PHASE 3 DONE!\n\n`);

				/// PHASE 4: DELETED CONTENT IN RD SERVERS
				setFixOutput((prev) => prev + `PHASE 4 PREPARATION\n`);
				await refreshData();
				let streamable = rdDownloads.filter((d) => d.streamable);
				if (
					!confirm(
						`This will check ${
							streamable.length
						} downloads and will take approx ${Math.ceil(
							(streamable.length / 1200) * 1.1
						)} minutes. Proceed?`
					)
				)
					return;
				setFixOutput(
					(prev) =>
						prev + `Checking ${streamable.length} downloads. Do not close this tab!\n`
				);
				for (let i = 0; i < streamable.length; i += 20) {
					const batch = streamable.slice(i, i + 20);
					processBatch(batch);
					if (i % 100 === 0 && i > 0) {
						setFixOutput(
							(prev) =>
								prev +
								`Processing ${i}th item (${Math.ceil(
									(i / streamable.length) * 100
								)}%)\n`
						);
					}
					await delay(1000);
				}
				setFixOutput((prev) => prev + `PHASE 4 DONE!\n\n`);
			} catch (e) {
				setFixOutput((prev) => prev + `RD error: ${e}\n`);
			}
		}
		setFixOutput(
			(prev) =>
				prev +
				`Finished! Consider restarting your Real-Debrid WebDAV or rclone_RD mount to clear its cache\n`
		);
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<h1 className="text-2xl font-bold mb-4">Maintenance</h1>
			{!fixRunning && (
				<button onClick={startTest} className="bg-blue-500 text-white px-4 py-2 rounded">
					Real-Debrid: Fix unstreamable/unscannable content
				</button>
			)}
			{fixRunning && <pre className="max-w-5xl">{fixOutput}</pre>}
		</div>
	);
}

export default withAuth(FixerPage);
