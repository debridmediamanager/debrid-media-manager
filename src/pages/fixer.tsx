import { useRealDebridAccessToken } from '@/hooks/auth';
import {
	DownloadResponse,
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

async function downloadFirstByte(url: string): Promise<number> {
	const controller = new AbortController();
	const signal = controller.signal;
	try {
		const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
		const reader = response.body?.getReader();
		if (!reader) return 500;
		await reader.read();
		return response.status;
	} catch (error) {
		return 500;
	} finally {
		controller.abort();
	}
}

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

	const processBatch = async (batch: DownloadResponse[]) => {
		const promises = batch.map(async (item) => {
			let downloadLink = item.download;
			try {
				const downloadStatus = await downloadFirstByte(
					`https://corsproxy.org/?${downloadLink}`
				);
				if (downloadStatus < 300) {
					setFixOutput((prev) => prev + `Identified: ${item.filename}...`);
					await deleteDownload(rdKey!, item.id);
					await unrestrictLink(rdKey!, item.link);
					setFixOutput((prev) => prev + `done!\n`);
				}
			} catch (e) {
				setFixOutput((prev) => prev + `Identified: ${item.filename}...`);
				await deleteDownload(rdKey!, item.id);
				await unrestrictLink(rdKey!, item.link);
				setFixOutput((prev) => prev + `done!\n`);
			}
		});
		await Promise.all(promises);
	};

	const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	const startTest = async () => {
		if (rdKey) {
			try {
				if (!confirm(`This is an expensive server operation so please use it sparingly`))
					return;
				setFixRunning(true);
				let rdTorrents = await getUserTorrentsList(rdKey);
				setFixOutput(
					(prev) =>
						prev + `RD torrent count: ${rdTorrents.length}\nFetching downloads...\n`
				);
				let rdDownloads = await getDownloads(rdKey);
				setFixOutput((prev) => prev + `RD download count: ${rdDownloads.length}\n`);
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
					setFixOutput((prev) => prev + `Redownloading...`);
					const hash = badTorrent.hash;
					const id = await addHashAsMagnet(rdKey!, hash);
					const response = await getTorrentInfo(rdKey!, id);
					const selectedFiles = getSelectableFiles(
						response.files.filter(isVideoOrSubs)
					).map((file) => file.id);
					if (selectedFiles.length === 0) {
						setFixOutput((prev) => prev + `error: no file for selection\n`);
					} else {
						await selectFiles(rdKey!, id, selectedFiles);
						setFixOutput((prev) => prev + `done\nDeleting old torrent...\n`);
					}
					await deleteTorrent(rdKey!, badTorrent.id);
					setFixOutput((prev) => prev + `Bad torrent removed\n`);
				}
				let streamable = rdDownloads.filter((d) => d.streamable);
				if (
					!confirm(
						`This will process ${
							streamable.length
						} downloads and will take approx ${Math.ceil(
							(streamable.length / 1200) * 1.1
						)} minutes. Are you sure?`
					)
				)
					return;
				setFixOutput(
					(prev) =>
						prev +
						`Fixing unscannable content\nChecking ${streamable.length} downloads. Do not close this tab!\n`
				);
				for (let i = 0; i < streamable.length; i += 20) {
					const batch = streamable.slice(i, i + 20);
					processBatch(batch);
					if (i % 100 === 0 && i > 0) {
						setFixOutput((prev) => prev + `Processing ${i}th item, please wait...\n`);
					}
					await delay(1000);
				}
				setFixOutput((prev) => prev + `Done!\n`);
			} catch (e) {
				setFixOutput((prev) => prev + `RD error: ${e}\n`);
			}
		}
		setFixOutput(
			(prev) =>
				prev +
				`Finished! Restart your Real-Debrid WebDAV or rclone_RD mount to clear its cache\n`
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
			{fixRunning && <pre>{fixOutput}</pre>}
		</div>
	);
}

export default withAuth(FixerPage);
