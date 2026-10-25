import { CastManageConfig, CastManagePage } from '@/components/CastManagePage';
import { usePremiumizeCredential } from '@/hooks/auth';
import { usePremiumizeCastToken } from '@/hooks/premiumizeCastToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';

const config: CastManageConfig = {
	name: 'Premiumize',
	label: 'Premiumize',
	loginProvider: 'premiumize',
	apiPrefix: 'stremio-pm',
	castPath: '/stremio-premiumize',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	logTag: 'PremiumizeStremioManage',
	theme: {
		checkbox: 'text-yellow-600 focus:ring-yellow-500',
		castButton: 'bg-yellow-700 hover:bg-yellow-800',
		episode: 'text-yellow-300',
	},
};

export function PremiumizeManagePage() {
	// Either credential works: the OAuth device-code token or the API key
	const apiKey = usePremiumizeCredential();
	usePremiumizeCastToken({ enroll: true });
	return <CastManagePage config={config} apiKey={apiKey} />;
}

export default dynamic(() => Promise.resolve(withAuth(PremiumizeManagePage)), { ssr: false });
