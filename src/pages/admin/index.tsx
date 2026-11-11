import { ADMIN_PAGES, AdminLayout } from '@/components/admin/AdminLayout';
import Link from 'next/link';

export default function AdminPage() {
	return (
		<AdminLayout title="Admin">
			<ul className="flex flex-col gap-2">
				{ADMIN_PAGES.map((page) => (
					<li key={page.href}>
						<Link
							href={page.href}
							className="block rounded border-2 border-gray-600 bg-gray-800/30 px-4 py-3 text-gray-100 hover:bg-gray-800"
						>
							{page.label}
						</Link>
					</li>
				))}
			</ul>
		</AdminLayout>
	);
}
