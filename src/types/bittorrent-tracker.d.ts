declare module 'bittorrent-tracker' {
	interface ClientOptions {
		infoHash: string | Buffer;
		peerId: string | Buffer;
		announce?: string[];
		port?: number;
		uploaded?: number;
		downloaded?: number;
		left?: number;
		compact?: boolean;
		numWant?: number;
	}

	interface ScrapeOptions {
		announce: string;
		infoHash: string | Buffer;
	}

	interface ScrapeResult {
		complete: number;
		incomplete: number;
		downloaded: number;
	}

	interface ScrapeData {
		[announceUrl: string]: {
			[infoHash: string]: {
				complete?: number;
				incomplete?: number;
				downloaded?: number;
			};
		};
	}

	class Client {
		constructor(opts: ClientOptions);
		on(event: 'error', listener: (err: Error) => void): this;
		on(event: 'warning', listener: (err: Error) => void): this;
		on(event: 'update', listener: (data: any) => void): this;
		on(event: 'complete', listener: () => void): this;
		on(event: 'start', listener: () => void): this;
		on(event: 'stop', listener: () => void): this;
		on(event: 'scrape', listener: (data: ScrapeResult) => void): this;
		scrape(): void;
		update(opts?: any): void;
		start(opts?: any): void;
		stop(opts?: any): void;
		complete(opts?: any): void;
		destroy(callback?: () => void): void;

		// Static methods
		static scrape(
			opts: ScrapeOptions,
			callback: (err: Error | null, data?: ScrapeResult) => void
		): void;
	}

	export default Client;
	export { Client };
}
