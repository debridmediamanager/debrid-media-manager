import { CastPage, CastPageConfig } from '@/components/CastPage';
import { useOffcloudCastToken } from '@/hooks/offcloudCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastPageConfig = {
	name: 'Offcloud',
	service: 'oc',
	accentColor: 'orange',
	apiPrefix: 'stremio-oc',
	castPath: '/stremio-offcloud',
	loginPath: '/offcloud/login',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	hasCredentials: () =>
		// Offcloud has one credential and no OAuth: the account-page API key.
		!!localStorage.getItem('oc:apiKey'),
	theme: {
		heading: 'text-orange-400',
		icon: 'text-orange-400',
		button: 'border-orange-500 bg-orange-800/30 hover:bg-orange-700/50',
		buttonText: 'text-orange-100',
		alert: 'text-orange-400',
		alertBox: 'border-orange-500 bg-orange-900/20',
	},
};

export function StremioOffcloudPage() {
	const dmmCastToken = useOffcloudCastToken({ enroll: true });
	return <CastPage config={config} dmmCastToken={dmmCastToken} />;
}

export default dynamic(() => Promise.resolve(withAuth(StremioOffcloudPage)), { ssr: false });
