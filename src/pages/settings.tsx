import { Logo } from '@/components/Logo';
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
			<Logo />
			<Toaster position={toasterPosition()} />
			<div className="mt-6 flex w-full max-w-md flex-col items-center gap-6">
				<Link
					href="/"
					className="inline-flex w-full items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to dashboard</span>
				</Link>
				<SettingsSection />
			</div>
		</div>
	);
}

export default withAuth(SettingsPage);
