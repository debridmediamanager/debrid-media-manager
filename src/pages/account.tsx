import useLocalStorage from '@/hooks/localStorage';
import { withAuth } from '@/utils/withAuth';

interface MyAccount {
	libraryType: '1080p' | '2160p';
}

function AccountPage() {
	const myAccount = useLocalStorage<MyAccount>('myAccount', {
		libraryType: '2160p',
	});

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<h1 className="text-2xl font-bold">Debrid Media Manager is loading...</h1>
		</div>
	);
}

export default withAuth(AccountPage);
