import { CastManageConfig, CastManagePage } from '@/components/CastManagePage';
import { useOffcloudApiKey } from '@/hooks/auth';
import { useOffcloudCastToken } from '@/hooks/offcloudCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastManageConfig = {
	name: 'Offcloud',
	label: 'Offcloud',
	loginProvider: 'offcloud',
	apiPrefix: 'stremio-oc',
	castPath: '/stremio-offcloud',
	logTag: 'OffcloudStremioManage',
	theme: {
		checkbox: 'text-orange-600 focus:ring-orange-500',
		castButton: 'bg-orange-700 hover:bg-orange-800',
		episode: 'text-orange-300',
	},
};

export function OffcloudManagePage() {
	// Offcloud has one credential and no OAuth: the account-page API key.
	const apiKey = useOffcloudApiKey();
	useOffcloudCastToken({ enroll: true });
	return <CastManagePage config={config} apiKey={apiKey} />;
}

export default dynamic(() => Promise.resolve(withAuth(OffcloudManagePage)), { ssr: false });
