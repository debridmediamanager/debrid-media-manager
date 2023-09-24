import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { getUserTorrentsList } from '@/services/realDebrid';
import { withAuth } from '@/utils/withAuth';

function TroubleshootingPage() {
	// keys
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();

	const fetchRdTorrents = async () => {
		if (!rdKey) throw new Error('no_rd_key');
		const torrents = await getUserTorrentsList(rdKey);
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<h1 className="text-2xl font-bold mb-4">Troubleshooting</h1>
		</div>
	);
}

export default withAuth(TroubleshootingPage);
