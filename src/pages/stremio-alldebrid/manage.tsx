import { CastManageConfig, CastManagePage } from '@/components/CastManagePage';
import { useAllDebridCastToken } from '@/hooks/allDebridCastToken';
import useLocalStorage from '@/hooks/localStorage';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastManageConfig = {
	name: 'AllDebrid',
	label: 'AllDebrid',
	loginProvider: 'alldebrid',
	apiPrefix: 'stremio-ad',
	castPath: '/stremio-alldebrid',
	logTag: 'AllDebridStremioManage',
	theme: {
		checkbox: 'text-yellow-600 focus:ring-yellow-500',
		castButton: 'bg-yellow-700 hover:bg-yellow-800',
		episode: 'text-yellow-300',
	},
};

export function AllDebridManagePage() {
	const [apiKey] = useLocalStorage<string>('ad:apiKey');
	useAllDebridCastToken({ enroll: true });
	return <CastManagePage config={config} apiKey={apiKey} />;
}

export default dynamic(() => Promise.resolve(withAuth(AllDebridManagePage)), { ssr: false });
