import { DatabaseClient } from './client';

/** One `NewznabIndexer` row, as stored. Holds the API key: server-side only. */
export interface NewznabIndexerRow {
	prefix: string;
	name: string;
	url: string;
	apiKey: string;
	keyless: boolean;
	enabled: boolean;
	position: number;
	pacingRate: number | null;
	pacingWindow: number | null;
	grabRate: number | null;
	grabWindow: number | null;
	createdAt: Date;
	updatedAt: Date;
}

export type NewznabIndexerInput = Omit<NewznabIndexerRow, 'createdAt' | 'updatedAt'>;

// No delete on purpose: a prefix lives on in every release id handed out, so a row
// is disabled instead and its prefix can never be taken by another server.
export class NewznabIndexerService extends DatabaseClient {
	public async listIndexers(): Promise<NewznabIndexerRow[]> {
		return this.prisma.newznabIndexer.findMany({
			orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
		});
	}

	public async getIndexer(prefix: string): Promise<NewznabIndexerRow | null> {
		return this.prisma.newznabIndexer.findUnique({ where: { prefix } });
	}

	public async createIndexer(data: NewznabIndexerInput): Promise<NewznabIndexerRow> {
		return this.prisma.newznabIndexer.create({ data });
	}

	public async updateIndexer(
		prefix: string,
		data: Partial<Omit<NewznabIndexerInput, 'prefix'>>
	): Promise<NewznabIndexerRow> {
		return this.prisma.newznabIndexer.update({ where: { prefix }, data });
	}
}
