import useMyAccount, { MyAccount } from '@/hooks/account';
import { useCurrentUser } from '@/hooks/auth';
import { withAuth } from '@/utils/withAuth';
import { useRouter } from 'next/router';
import { toast, Toaster } from 'react-hot-toast';

function IndexPage() {
	const router = useRouter();
	const user = useCurrentUser();
	const [myAccount, setMyAccount] = useMyAccount();

	const handleLibraryTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		setMyAccount({ ...myAccount, libraryType: event.target.value as MyAccount['libraryType'] });
		toast.success('Changes saved');
	};

	const handleCollectionClick = () => {
		router.push('/collection');
	};

	const handleSearchClick = () => {
		router.push('/search');
	};

	const handleLogout = () => {
		if (typeof window === 'undefined') {
			// Running on the server, return null
			return null;
		}
		localStorage.clear();
		router.push('/start');
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<Toaster position="top-right" />
			{user ? (
				<>
					<h1 className="text-2xl font-bold mb-4">Debrid Media Manager</h1>
					<div className="flex flex-col items-center">
						<p className="text-lg font-bold">Welcome back, {user.username}!</p>
						<div className="mt-4">
							<label htmlFor="libraryType" className="mr-2">
								You are building what type of library?
							</label>
							<select
								id="libraryType"
								value={myAccount!.libraryType}
								onChange={handleLibraryTypeChange}
								className="border rounded p-1"
							>
								<option value="1080p">1080p</option>
								<option value="2160p">2160p</option>
								<option value="1080pOr2160p">does not matter</option>
							</select>
						</div>
						{myAccount!.libraryType === '1080pOr2160p' && (
							<div className="mt-4">
								Choosing &quot;does not matter&quot; also nets you less results
							</div>
						)}
						<div className="flex mt-4">
							<button
								className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleCollectionClick}
							>
								My Collection
							</button>
							<button
								className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleSearchClick}
							>
								Search
							</button>
						</div>
						<div className="flex mt-4">
							<button
								className="mr-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleLogout}
							>
								Logout
							</button>
						</div>
					</div>
				</>
			) : (
				<h1 className="text-2xl font-bold">Debrid Media Manager is loading...</h1>
			)}
		</div>
	);
}

export default withAuth(IndexPage);
