import { LibraryMainView } from '@/features/library/components/LibraryMainView';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import { Toaster } from 'react-hot-toast';

function TorrentsPage() {
	return (
		<>
			<Head>
				<title>Debrid Media Manager - Library</title>
			</Head>
			<Toaster position="bottom-right" />
			<LibraryMainView />
		</>
	);
}

export default withAuth(TorrentsPage);
