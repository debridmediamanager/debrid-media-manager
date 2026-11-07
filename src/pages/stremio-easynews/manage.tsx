import { CastManageConfig, CastManagePage } from '@/components/CastManagePage';
import { useEasynewsCastToken } from '@/hooks/easynewsCastToken';
import useLocalStorage from '@/hooks/localStorage';
import type { EasynewsCredentials } from '@/services/easynews';
import { easynewsCastKey } from '@/utils/easynewsCastKey';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastManageConfig = {
	name: 'Easynews',
	label: 'Easynews',
	loginProvider: 'easynews',
	apiPrefix: 'stremio-en',
	castPath: '/stremio-easynews',
	logTag: 'EasynewsStremioManage',
	theme: {
		checkbox: 'text-blue-600 focus:ring-blue-500',
		castButton: 'bg-blue-700 hover:bg-blue-800',
		episode: 'text-blue-300',
	},
};

export function EasynewsManagePage() {
	const [account] = useLocalStorage<EasynewsCredentials>('en:account');
	useEasynewsCastToken({ enroll: true });
	const apiKey = account?.username && account?.password ? easynewsCastKey(account) : null;
	return <CastManagePage config={config} apiKey={apiKey} />;
}

export default dynamic(() => Promise.resolve(withAuth(EasynewsManagePage)), { ssr: false });
