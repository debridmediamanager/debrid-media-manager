import LibraryActionButtons from '@/components/LibraryActionButtons';
import LibraryHelpText from '@/components/LibraryHelpText';
import LibraryMenuButtons from '@/components/LibraryMenuButtons';
import LibrarySize from '@/components/LibrarySize';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import UserTorrentDB from '@/torrent/db';
import { handleSelectTorrent, resetSelection, selectShown } from '@/utils/librarySelection';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import Swal from 'sweetalert2';
import { useLibraryBatchActions } from '../hooks/useLibraryBatchActions';
import { useLibraryData } from '../hooks/useLibraryData';
import { useLibraryFilter } from '../hooks/useLibraryFilter';
import { useLibrarySortAndPaginate } from '../hooks/useLibrarySortAndPaginate';
import { handleAddTorrent } from '../utils/handleAddTorrent';
import LibraryTable from './LibraryTable';

const tips = [
	'Tip: You can use hash lists to share your library with others anonymously. Click on the button, wait for the page to finish processing, and share the link to your friends.',
	'Tip: You can make a local backup of your library by using the "Local backup" button. This will generate a file containing your whole library that you can use to restore your library later.',
	'Tip: You can restore a local backup by using the "Local restore" button. It will only restore the torrents that are not already in your library.',
	'Tip: The quick search box will filter the list by filename and id. You can use multiple words or even regex to filter your library. This way, you can select multiple torrents and delete them at once, or share them as a hash list.',
	'Have you tried clicking on a torrent? You can see the links, the progress, and the status of the torrent. You can also select the files you want to download.',
	'I don\'t know what to put here, so here\'s a random tip: "The average person walks the equivalent of five times around the world in a lifetime."',
];

export function LibraryMainView() {
	const router = useRouter();
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [helpText, setHelpText] = useState<string>('');
	const [uncachedRdHashes] = useState<Set<string>>(new Set<string>());
	const [uncachedAdIDs] = useState<string[]>([]);
	const torrentDB = new UserTorrentDB();

	const {
		userTorrentsList,
		setUserTorrentsList,
		loading,
		rdSyncing,
		adSyncing,
		selectedTorrents,
		setSelectedTorrents,
		triggerFetchLatestRDTorrents,
		triggerFetchLatestADTorrents,
	} = useLibraryData(rdKey, adKey);

	const {
		query,
		setQuery,
		filtering,
		grouping,
		filteredList,
		totalBytes,
		slowCount,
		inProgressCount,
		failedCount,
		groupingState,
		hasNoQueryParamsBut,
	} = useLibraryFilter(
		userTorrentsList,
		loading,
		uncachedRdHashes,
		uncachedAdIDs,
		selectedTorrents
	);

	const {
		sortBy,
		handleSort,
		currentPage,
		handlePrevPage,
		handleNextPage,
		currentPageData,
		maxPages,
	} = useLibrarySortAndPaginate(filteredList);

	const {
		handleDeleteShownTorrents,
		handleReinsertTorrents,
		handleGenerateHashlist,
		dedupeBySize,
		dedupeByRecency,
		combineSameHash,
		localBackup,
		handleLocalRestore,
	} = useLibraryBatchActions(
		rdKey,
		adKey,
		userTorrentsList,
		setUserTorrentsList,
		setSelectedTorrents,
		torrentDB,
		triggerFetchLatestRDTorrents,
		triggerFetchLatestADTorrents
	);

	// Use selectedTorrents to determine which list to use
	const relevantList =
		selectedTorrents.size > 0
			? userTorrentsList.filter((t) => selectedTorrents.has(t.id))
			: filteredList;

	function setHelpTextBasedOnTime() {
		const date = new Date();
		const minute = date.getMinutes();
		const index = minute % tips.length;
		const randomTip = tips[index];
		if (helpText !== 'hide') setHelpText(randomTip);
	}

	return (
		<div className="mx-1 my-0 min-h-screen bg-gray-900 text-gray-100">
			<Toaster position="bottom-right" />
			<div className="mb-1 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">
					Library 📚{' '}
					<LibrarySize
						torrentCount={userTorrentsList.length}
						totalBytes={totalBytes}
						isLoading={rdSyncing || adSyncing}
					/>
				</h1>

				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-0.5 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>
			<div className="mb-2 flex items-center border-b-2 border-gray-600 py-0">
				<input
					className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-0.5 text-xs leading-tight text-gray-100 focus:outline-none"
					type="text"
					id="query"
					placeholder="search by filename/hash/id, supports regex"
					value={query}
					onChange={(e) => setQuery(e.target.value.toLocaleLowerCase())}
				/>
			</div>
			<LibraryMenuButtons
				currentPage={currentPage}
				maxPages={maxPages}
				onPrevPage={handlePrevPage}
				onNextPage={handleNextPage}
				onResetFilters={() => {
					setQuery('');
					setHelpText('');
					setSelectedTorrents(new Set());
					router.push('/library?page=1');
				}}
				sameHashSize={groupingState.sameHash.size}
				sameTitleSize={groupingState.sameTitle.size}
				selectedTorrentsSize={selectedTorrents.size}
				uncachedCount={uncachedAdIDs.length + uncachedRdHashes.size}
				inProgressCount={inProgressCount}
				slowCount={slowCount}
				failedCount={failedCount}
			/>
			<LibraryActionButtons
				onSelectShown={() => selectShown(currentPageData(), setSelectedTorrents)}
				onResetSelection={() => resetSelection(setSelectedTorrents)}
				onReinsertTorrents={() => handleReinsertTorrents(relevantList)}
				onGenerateHashlist={() => handleGenerateHashlist(relevantList)}
				onDeleteShownTorrents={() => handleDeleteShownTorrents(relevantList)}
				onLocalRestore={handleLocalRestore}
				onLocalBackup={async () => {
					const result = await Swal.fire({
						title: 'Choose backup type',
						text: `Do you want to backup all torrents (${userTorrentsList.length}) or just the filtered list (${filteredList.length})?`,
						icon: 'question',
						showDenyButton: true,
						confirmButtonText: 'All Torrents',
						denyButtonText: 'Filtered List',
						confirmButtonColor: '#3085d6',
						denyButtonColor: '#2b5c8f',
						showCancelButton: true,
						cancelButtonText: 'Cancel',
					});

					if (result.isConfirmed) {
						await localBackup(userTorrentsList);
					} else if (result.isDenied) {
						await localBackup(filteredList);
					}
				}}
				onDedupeBySize={() => dedupeBySize(filteredList)}
				onDedupeByRecency={() => dedupeByRecency(filteredList)}
				onCombineSameHash={() => combineSameHash(filteredList)}
				selectedTorrentsSize={selectedTorrents.size}
				rdKey={rdKey}
				adKey={adKey}
				onAddMagnet={(debridService: string) =>
					handleAddTorrent(
						debridService,
						rdKey,
						adKey,
						triggerFetchLatestRDTorrents,
						triggerFetchLatestADTorrents
					)
				}
				showDedupe={
					router.query.status === 'sametitle' ||
					(!!router.query.title && filteredList.length > 1)
				}
				showHashCombine={
					router.query.status === 'samehash' ||
					(!!router.query.hash && filteredList.length > 1)
				}
			/>
			<LibraryHelpText helpText={helpText} onHide={() => setHelpText('hide')} />
			<div className="overflow-x-auto">
				{loading || grouping || filtering ? (
					<div className="mt-2 flex items-center justify-center">
						<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
					</div>
				) : (
					<LibraryTable
						data={currentPageData()}
						sortBy={sortBy}
						onSort={handleSort}
						selectedTorrents={selectedTorrents}
						onSelectTorrent={(id: string) =>
							handleSelectTorrent(id, selectedTorrents, setSelectedTorrents)
						}
						rdKey={rdKey}
						adKey={adKey}
						groupingState={groupingState}
						setUserTorrentsList={setUserTorrentsList}
						setSelectedTorrents={setSelectedTorrents}
						torrentDB={torrentDB}
					/>
				)}
			</div>
		</div>
	);
}
