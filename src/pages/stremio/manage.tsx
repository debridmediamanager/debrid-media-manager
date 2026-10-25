import { CastManageConfig, CastManagePage } from '@/components/CastManagePage';
import { useRealDebridAccessToken } from '@/hooks/auth';
import { useCastToken } from '@/hooks/castToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastManageConfig = {
	name: 'Real-Debrid',
	label: '',
	loginProvider: 'realdebrid',
	apiPrefix: 'stremio',
	castPath: '/stremio',
	logo: 'https://static.debridmediamanager.com/greenlogo.jpeg',
	logTag: 'StremioManage',
	legacyRdApi: true,
	theme: {
		checkbox: 'text-green-600 focus:ring-green-500',
		castButton: 'bg-green-700 hover:bg-green-800',
		episode: 'text-green-300',
	},
};

export function ManagePage() {
	const [apiKey, apiKeyLoading] = useRealDebridAccessToken();
	useCastToken();
	return <CastManagePage config={config} apiKey={apiKey} apiKeyLoading={apiKeyLoading} />;
}

export default dynamic(() => Promise.resolve(withAuth(ManagePage)), { ssr: false });
