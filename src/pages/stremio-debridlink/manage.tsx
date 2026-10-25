import { CastManageConfig, CastManagePage } from '@/components/CastManagePage';
import { useDebridLinkCredential } from '@/hooks/auth';
import { useDebridLinkCastToken } from '@/hooks/debridLinkCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastManageConfig = {
	name: 'Debrid-Link',
	label: 'Debrid-Link',
	loginProvider: 'debridlink',
	apiPrefix: 'stremio-dl',
	castPath: '/stremio-debridlink',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	logTag: 'DebridLinkStremioManage',
	theme: {
		checkbox: 'text-sky-600 focus:ring-sky-500',
		castButton: 'bg-sky-700 hover:bg-sky-800',
		episode: 'text-sky-300',
	},
};

export function DebridLinkManagePage() {
	// Either an OAuth access token or a pasted API token - both authenticate the
	// same Bearer header, and the token wins because it is the narrower one.
	const apiKey = useDebridLinkCredential();
	useDebridLinkCastToken({ enroll: true });
	return <CastManagePage config={config} apiKey={apiKey} />;
}

export default dynamic(() => Promise.resolve(withAuth(DebridLinkManagePage)), { ssr: false });
