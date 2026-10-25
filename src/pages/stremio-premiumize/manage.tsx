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
	logTag: 'PremiumizeStremioManage',
	theme: {
		checkbox: 'text-red-600 focus:ring-red-500',
		castButton: 'bg-red-700 hover:bg-red-800',
		episode: 'text-red-300',
	},
};

export function PremiumizeManagePage() {
	// Either credential works: the OAuth device-code token or the API key
	const apiKey = usePremiumizeCredential();
	usePremiumizeCastToken({ enroll: true });
	return <CastManagePage config={config} apiKey={apiKey} />;
}

export default dynamic(() => Promise.resolve(withAuth(PremiumizeManagePage)), { ssr: false });
