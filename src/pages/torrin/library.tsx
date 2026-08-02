import useLocalStorage from '@/hooks/localStorage';
import {
	deleteTorrinTorrent,
	getTorrinTorrentInfo,
	getTorrinTorrentsList,
	unrestrictTorrinLink,
} from '@/services/torrin';
import { UserTorrentResponse } from '@/services/types';
import { Loader2, Play, RefreshCw, Trash2 } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

function fmtSize(bytes: number): string {
	if (!bytes) return '';
	const gb = bytes / 1024 ** 3;
	return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export default function TorrinLibraryPage() {
	const [baseUrl] = useLocalStorage<string>('torrin:baseUrl');
	const [apiKey] = useLocalStorage<string>('torrin:apiKey');
	const [torrents, setTorrents] = useState<UserTorrentResponse[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!baseUrl || !apiKey) return;
		setLoading(true);
		try {
			const { data } = await getTorrinTorrentsList(baseUrl, apiKey, 1000, 1);
			setTorrents(data);
		} catch (e: any) {
			toast.error(`Torrin: ${e?.message ?? 'failed to load library'}`);
		} finally {
			setLoading(false);
		}
	}, [baseUrl, apiKey]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const play = async (t: UserTorrentResponse) => {
		if (!baseUrl || !apiKey) return;
		setBusy(t.id);
		try {
			const info = await getTorrinTorrentInfo(baseUrl, apiKey, t.id);
			const link = info.links?.[0];
			if (!link) throw new Error('no link available');
			const res = await unrestrictTorrinLink(baseUrl, apiKey, link);
			window.open(res.download, '_blank');
		} catch (e: any) {
			toast.error(`Torrin: ${e?.message ?? 'could not get stream link'}`);
		} finally {
			setBusy(null);
		}
	};

	const remove = async (id: string) => {
		if (!baseUrl || !apiKey) return;
		setBusy(id);
		try {
			await deleteTorrinTorrent(baseUrl, apiKey, id);
			setTorrents((prev) => prev.filter((t) => t.id !== id));
		} catch (e: any) {
			toast.error(`Torrin: ${e?.message ?? 'could not delete'}`);
		} finally {
			setBusy(null);
		}
	};

	if (!baseUrl || !apiKey) {
		return (
			<div className="flex h-screen flex-col items-center justify-center">
				<p className="mb-4">Connect Torrin first.</p>
				<Link href="/torrin/login" className="rounded bg-blue-500 px-4 py-2 text-white">
					Connect Torrin
				</Link>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-4xl p-4">
			<Head>
				<title>Debrid Media Manager - Torrin Library</title>
			</Head>
			<div className="mb-4 flex items-center justify-between">
				<h1 className="text-2xl font-bold">Torrin Library</h1>
				<button
					onClick={refresh}
					className="inline-flex items-center gap-1 rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
				>
					<RefreshCw className="h-4 w-4" /> Refresh
				</button>
			</div>
			{loading ? (
				<div className="flex justify-center p-8">
					<Loader2 className="h-6 w-6 animate-spin" />
				</div>
			) : torrents.length === 0 ? (
				<p className="text-center text-gray-400">No torrents in your Torrin library yet.</p>
			) : (
				<div className="space-y-2">
					{torrents.map((t) => (
						<div
							key={t.id}
							className="flex items-center gap-2 rounded border border-gray-700 p-2"
						>
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm">{t.filename}</div>
								<div className="text-xs text-gray-400">
									{fmtSize(t.bytes)} · {t.status}
									{t.status !== 'downloaded' && t.progress != null
										? ` ${t.progress}%`
										: ''}
								</div>
							</div>
							<button
								onClick={() => play(t)}
								disabled={busy === t.id || t.status !== 'downloaded'}
								className="rounded border-2 border-green-500 bg-green-900/30 p-1 text-green-100 disabled:opacity-40"
								title="Play"
							>
								{busy === t.id ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Play className="h-4 w-4" />
								)}
							</button>
							<button
								onClick={() => remove(t.id)}
								disabled={busy === t.id}
								className="rounded border-2 border-red-500 bg-red-900/30 p-1 text-red-100 disabled:opacity-40"
								title="Delete"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
