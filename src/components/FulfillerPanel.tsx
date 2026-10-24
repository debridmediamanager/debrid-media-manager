import { useSponsor } from '@/hooks/useSponsor';
import {
	fetchFulfillerStats,
	fetchLeaderboard,
	linkFulfiller,
	type FulfillerStats,
	type LeaderboardEntry,
} from '@/utils/contentRequestsApi';
import { Gift, Heart, Trophy } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

const GATEKEEPER_URL = 'https://gatekeeper.debridmediamanager.com';

/**
 * A fulfiller's own sends, the thanks they got, and progress toward sponsor
 * time. Linking a DMM API key is what collects the reward; any gatekeeper
 * account has one, sponsor or not.
 */
export function FulfillerPanel({ rdKey, tbKey }: { rdKey: string | null; tbKey: string }) {
	const sponsor = useSponsor();
	const [stats, setStats] = useState<FulfillerStats | null>(null);
	const [editing, setEditing] = useState(false);
	const [apiKey, setApiKey] = useState('');
	const [showName, setShowName] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		fetchFulfillerStats(rdKey, tbKey)
			.then((s) => {
				if (cancelled) return;
				setStats(s);
				setShowName(s.showName);
			})
			.catch(() => !cancelled && setStats(null));
		return () => {
			cancelled = true;
		};
	}, [rdKey, tbKey]);

	// The key this browser already holds for sponsor perks, if any.
	useEffect(() => {
		if (sponsor.apiKey) setApiKey((prev) => prev || sponsor.apiKey || '');
	}, [sponsor.apiKey]);

	if (!stats) return null;

	const toward = stats.credited % stats.sendsPerBlock;
	const pct = Math.round((toward / stats.sendsPerBlock) * 100);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!apiKey.trim() || busy) return;
		setBusy(true);
		try {
			const next = await linkFulfiller(rdKey, tbKey, apiKey.trim(), showName);
			setStats(next);
			setEditing(false);
			// Earned time is a sponsorship like any other, so open it in this
			// browser now rather than making them find the settings panel.
			if (next.earnedUntil && !sponsor.isSponsor) await sponsor.link(apiKey.trim());
			toast.success('Linked. Your sends now earn sponsor time.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not link');
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="mb-4 rounded-lg border-2 border-pink-500/40 bg-pink-900/10 p-3 text-xs text-gray-300">
			<div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
				<span className="flex items-center font-bold text-white">
					<Gift className="mr-1 h-4 w-4 text-pink-400" />
					Your sends
				</span>
				<span>
					<span className="font-bold text-white">{stats.sends}</span> sent
				</span>
				<span className="flex items-center">
					<Heart className="mr-1 h-3 w-3 text-pink-400" />
					<span className="font-bold text-white">{stats.thanked}</span>&nbsp;thanked
				</span>
				{stats.earnedUntil && (
					<span className="text-emerald-300">
						Sponsor perks until {new Date(stats.earnedUntil).toLocaleDateString()}
					</span>
				)}
			</div>

			<div className="mb-1">
				Every {stats.sendsPerBlock} sends earn {stats.daysPerBlock} days of DMM{' '}
				<Link href="/settings" className="text-pink-300 underline hover:text-pink-200">
					sponsor perks
				</Link>{' '}
				like Torznab and Newznab. It does not include zurg or rex access. One send per asker
				per day counts.
			</div>
			<div
				className="h-2 w-full overflow-hidden rounded bg-gray-700"
				role="progressbar"
				aria-valuenow={toward}
				aria-valuemin={0}
				aria-valuemax={stats.sendsPerBlock}
				aria-label="Sends toward your next reward"
			>
				<div className="h-full bg-pink-500" style={{ width: `${pct}%` }} />
			</div>
			<div className="mt-1 text-gray-400">
				{toward} of {stats.sendsPerBlock} toward your next {stats.daysPerBlock} days
			</div>

			{stats.linked && !editing ? (
				<div className="mt-2 text-gray-400">
					Linked to your DMM account
					{stats.showName ? ', shown by name on the leaderboard' : ''}.{' '}
					<button
						onClick={() => setEditing(true)}
						className="text-pink-300 underline hover:text-pink-200"
					>
						Change
					</button>
				</div>
			) : (
				<form onSubmit={submit} className="mt-2 flex flex-col gap-2">
					<label htmlFor="fulfiller-api-key">
						{stats.linked ? 'Link again' : 'To collect, paste your DMM API key'}. No
						sponsorship needed: sign in at{' '}
						<a
							href={GATEKEEPER_URL}
							target="_blank"
							rel="noreferrer"
							className="text-pink-300 underline hover:text-pink-200"
						>
							gatekeeper
						</a>{' '}
						with GitHub to get one. Sends you already made count.
					</label>
					<input
						id="fulfiller-api-key"
						type="text"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						placeholder="64-character DMM API key"
						autoComplete="off"
						spellCheck={false}
						className="rounded border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-pink-400 focus:outline-hidden"
					/>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={showName}
							onChange={(e) => setShowName(e.target.checked)}
						/>
						Show my GitHub name on the leaderboard
					</label>
					<button
						type="submit"
						disabled={busy || !apiKey.trim()}
						className="haptic-sm self-start rounded border-2 border-pink-500 bg-pink-900/30 px-3 py-1.5 text-pink-100 transition-colors hover:bg-pink-800/50 disabled:opacity-50"
					>
						{busy ? 'Linking…' : 'Link'}
					</button>
				</form>
			)}
		</section>
	);
}

function Board({ title, rows }: { title: string; rows: LeaderboardEntry[] }) {
	return (
		<div className="min-w-0 flex-1">
			<div className="mb-1 font-bold text-white">{title}</div>
			{rows.length === 0 ? (
				<div className="text-gray-500">Nobody yet. Be the first.</div>
			) : (
				<ol className="list-none">
					{rows.map((row, i) => (
						<li key={i} className="flex justify-between gap-2">
							<span className="truncate">
								{i + 1}.{' '}
								{row.name ?? <span className="text-gray-500">Anonymous</span>}
							</span>
							<span className="shrink-0 font-bold text-white">{row.sends}</span>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}

/** Top fulfillers this week and of all time. Names only for those who opted in. */
export function Leaderboard() {
	const [data, setData] = useState<{
		week: LeaderboardEntry[];
		allTime: LeaderboardEntry[];
	} | null>(null);

	useEffect(() => {
		fetchLeaderboard()
			.then(setData)
			.catch(() => setData(null));
	}, []);

	if (!data || (data.week.length === 0 && data.allTime.length === 0)) return null;

	return (
		<section className="mb-4 rounded-lg border-2 border-amber-500/40 bg-amber-900/10 p-3 text-xs text-gray-300">
			<div className="mb-2 flex items-center font-bold text-white">
				<Trophy className="mr-1 h-4 w-4 text-amber-400" />
				Top fulfillers
			</div>
			<div className="flex gap-6">
				<Board title="This week" rows={data.week} />
				<Board title="All time" rows={data.allTime} />
			</div>
		</section>
	);
}
