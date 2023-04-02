import { withAuth } from '@/utils/withAuth';

function AccountPage() {
	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<h1 className="text-2xl font-bold">Debrid Media Manager is loading...</h1>
		</div>
	);
}

export default withAuth(AccountPage);
