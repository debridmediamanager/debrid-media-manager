import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { genericToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import getConfig from 'next/config';
import { useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';

function TroubleshootingPage() {
	const { publicRuntimeConfig: config } = getConfig();

	// keys
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();

	const [testResults, setTestResults] = useState('Running test...\n-----\n');
	const [testRunning, setTestRunning] = useState(false);

	const startTest = async () => {
		let cachedRdDownloads = JSON.parse(
			localStorage.getItem('rd:downloads')?.toString() || '{}'
		);
		setTestResults(
			(prev) =>
				prev + `Real-Debrid cached downloads: ${Object.keys(cachedRdDownloads).length}\n`
		);
		localStorage.removeItem('rd:downloads');

		cachedRdDownloads = JSON.parse(localStorage.getItem('rd:downloads')?.toString() || '{}');
		setTestResults(
			(prev) =>
				prev + `Real-Debrid refreshed downloads: ${Object.keys(cachedRdDownloads).length}\n`
		);
		setTestResults((prev) => prev + `-----\n`);

		let cachedAdDownloads = JSON.parse(
			localStorage.getItem('ad:downloads')?.toString() || '{}'
		);
		setTestResults(
			(prev) =>
				prev + `AllDebrid cached downloads: ${Object.keys(cachedAdDownloads).length}\n`
		);
		localStorage.removeItem('ad:downloads');

		cachedAdDownloads = JSON.parse(localStorage.getItem('ad:downloads')?.toString() || '{}');
		setTestResults(
			(prev) =>
				prev + `AllDebrid refreshed downloads: ${Object.keys(cachedAdDownloads).length}\n`
		);
		setTestResults((prev) => prev + `-----\n`);

		setTestRunning(true);
		if (rdKey) {
			setTestResults((prev) => prev + `Real-Debrid base URL: ${config.realDebridHostname}\n`);
			try {
				let rdTorrents = await getUserTorrentsList(rdKey);
				setTestResults((prev) => prev + `RD torrent count: ${rdTorrents.length}\n`);
			} catch (e) {
				setTestResults((prev) => prev + `RD torrent error: ${e}\n`);
			}
			setTestResults((prev) => prev + `-----\n`);

			config.realDebridHostname = 'https://corsproxy.io/?https://api.real-debrid.com';
			setTestResults((prev) => prev + `Real-Debrid base URL: ${config.realDebridHostname}\n`);
			try {
				let rdTorrents = await getUserTorrentsList(rdKey);
				setTestResults((prev) => prev + `RD torrent count: ${rdTorrents.length}\n`);
			} catch (e) {
				setTestResults((prev) => prev + `RD torrent error: ${e}\n`);
			}
			setTestResults((prev) => prev + `-----\n`);

			config.realDebridHostname = 'https://api.real-debrid.com';
			setTestResults((prev) => prev + `Real-Debrid base URL: ${config.realDebridHostname}\n`);
			try {
				let rdTorrents = await getUserTorrentsList(rdKey);
				setTestResults((prev) => prev + `RD torrent count: ${rdTorrents.length}\n`);
			} catch (e) {
				setTestResults((prev) => prev + `RD torrent error: ${e}\n`);
			}
			setTestResults((prev) => prev + `-----\n`);
		}
		if (adKey) {
			let adBaseUrl = `${config.allDebridHostname}`;
			setTestResults((prev) => prev + `AllDebrid base URL: ${adBaseUrl}\n`);
			try {
				let adTorrents = (await getMagnetStatus(adKey)).data.magnets;
				setTestResults((prev) => prev + `AD torrent count: ${adTorrents.length}\n`);
			} catch (e) {
				setTestResults((prev) => prev + `AD torrent error: ${e}\n`);
			}
			setTestResults((prev) => prev + `-----\n`);

			adBaseUrl = `${config.allDebridHostname}`;
			setTestResults((prev) => prev + `AllDebrid base URL: ${adBaseUrl}\n`);
			try {
				let adTorrents = (await getMagnetStatus(adKey)).data.magnets;
				setTestResults((prev) => prev + `AD torrent count: ${adTorrents.length}\n`);
			} catch (e) {
				setTestResults((prev) => prev + `AD torrent error: ${e}\n`);
			}
			setTestResults((prev) => prev + `-----\n`);

			setTestResults((prev) => prev + `AllDebrid base URL: ${config.allDebridHostname}\n`);
			try {
				let adTorrents = (await getMagnetStatus(adKey)).data.magnets;
				setTestResults((prev) => prev + `AD torrent count: ${adTorrents.length}\n`);
			} catch (e) {
				setTestResults((prev) => prev + `AD torrent error: ${e}\n`);
			}
			setTestResults((prev) => prev + `-----\n`);
		}
		setTestResults((prev) => prev + `Test complete!\n`);

		toast(
			'Copy this and send to r/debridmediamanager or send to my Discord @ yowmamasita',
			genericToastOptions
		);
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<h1 className="text-2xl font-bold mb-4">Troubleshooting</h1>
			{!testRunning && (
				<button onClick={startTest} className="bg-blue-500 text-white px-4 py-2 rounded">
					Start Test
				</button>
			)}
			{testRunning && <pre>{testResults}</pre>}
			<Toaster position="bottom-right" />
		</div>
	);
}

export default withAuth(TroubleshootingPage);
