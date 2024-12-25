import { PrismaClient } from '@prisma/client';

export class DatabaseClient {
	private static instance: PrismaClient;
	protected prisma: PrismaClient;

	constructor() {
		this.prisma = DatabaseClient.getInstance();
	}

	private static getInstance(): PrismaClient {
		if (!DatabaseClient.instance) {
			DatabaseClient.instance = new PrismaClient({
				log: ['warn', 'error'],
			});

			// Handle cleanup on process termination
			['SIGINT', 'SIGTERM'].forEach((signal) => {
				process.on(signal, async () => {
					await DatabaseClient.instance.$disconnect();
				});
			});

			// Handle connection cleanup
			process.on('beforeExit', async () => {
				await DatabaseClient.instance.$disconnect();
			});
		}
		return DatabaseClient.instance;
	}

	// Ensure connection is properly closed when client is no longer needed
	public async disconnect(): Promise<void> {
		if (DatabaseClient.instance) {
			await DatabaseClient.instance.$disconnect();
		}
	}
}
