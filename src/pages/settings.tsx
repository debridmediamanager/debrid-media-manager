import { SettingsSection } from '@/components/SettingsSection';
import { toasterPosition } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import { ArrowLeft } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';

function SettingsPage() {
	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Settings</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Toaster position={toasterPosition()} />
			{/* Two columns of groups from 1024px, so the container widens there. */}
			<div className="flex w-full max-w-md flex-col gap-4 lg:max-w-4xl">
				<div className="flex items-center justify-between gap-2">
					<h1 className="text-lg font-semibold text-gray-100">Settings</h1>
					<Link
						href="/"
						className="inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
					>
						<ArrowLeft className="h-4 w-4" />
						<span>Back to dashboard</span>
					</Link>
				</div>
				<SettingsSection />
			</div>
		</div>
	);
}

export default withAuth(SettingsPage);
