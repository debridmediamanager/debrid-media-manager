import { CastManageConfig, CastManagePage } from '@/components/CastManagePage';
import useLocalStorage from '@/hooks/localStorage';
import { useTorBoxCastToken } from '@/hooks/torboxCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastManageConfig = {
	name: 'TorBox',
	label: 'TorBox',
	loginProvider: 'torbox',
	apiPrefix: 'stremio-tb',
	castPath: '/stremio-torbox',
	logTag: 'TorBoxStremioManage',
	bearerLinks: true,
	theme: {
		checkbox: 'text-purple-600 focus:ring-purple-500',
		castButton: 'bg-purple-600 hover:bg-purple-700',
		episode: 'text-purple-300',
	},
};

export function TorBoxManagePage() {
	const [apiKey] = useLocalStorage<string>('tb:apiKey');
	useTorBoxCastToken();
	return <CastManagePage config={config} apiKey={apiKey} />;
}

export default dynamic(() => Promise.resolve(withAuth(TorBoxManagePage)), { ssr: false });
