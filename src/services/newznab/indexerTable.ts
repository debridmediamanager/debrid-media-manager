import { cachedRead } from '@/services/cachedRead';
import type { NewznabIndexerRow } from '@/services/database/newznabIndexers';

// The NewznabIndexer table, read for both indexer lists: the aggregator's upstreams
// (`enabled`) and the title page's Usenet search (`mediaPage`). An empty table means
// neither has moved out of the environment yet. Imported lazily so nothing that pulls
// in nzb2rd also pulls in Prisma.

export const INDEXER_TABLE_TTL_MS = 30_000;

const table = cachedRead<NewznabIndexerRow[]>(
	async () => {
		const { NewznabIndexerService } = await import('@/services/database/newznabIndexers');
		const rows = await new NewznabIndexerService().listIndexers();
		return Array.isArray(rows) ? rows : [];
	},
	[],
	INDEXER_TABLE_TTL_MS,
	'Newznab indexers'
);

/** Every row, enabled or not, in table order; [] while the table is empty. */
export const loadIndexerRows = () => table.get();
export const invalidateIndexerTable = () => table.invalidate();
export const _resetIndexerTableForTest = () => table.resetForTest();
