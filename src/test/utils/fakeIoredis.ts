// One Redis shared by every client, as the four Swarm instances share one, for
// tests of `NewlyCachedStore`. It answers as ioredis 5.11.1 does with that
// store's options: down, single commands reject while `pipeline().exec()`
// resolves with an error per command; `timedOut`, a pipeline is applied and
// still reported as failed, which a client whose event loop stalled past
// `commandTimeout` does.
//
// Use: vi.mock('ioredis', async () => ({ default: (await import('@/test/utils/fakeIoredis')).FakeIoredis }));

export const fakeRedis = {
	values: new Map<string, { value: string; expiresAt: number }>(),
	down: false,
	timedOut: false,
	clients: 0,
	/** Every client's `error` handlers, in the order the clients were made. */
	errorHandlers: [] as Array<Array<() => void>>,
	reset() {
		this.values.clear();
		this.down = false;
		this.timedOut = false;
		this.clients = 0;
		this.errorHandlers = [];
	},
};

export class FakeIoredis {
	/** A client that has failed once stays closed, as one built not to reconnect does. */
	private closed = false;
	private handlers: Array<() => void> = [];
	constructor() {
		fakeRedis.clients++;
		fakeRedis.errorHandlers.push(this.handlers);
	}
	on(event: string, handler: () => void) {
		if (event === 'error') this.handlers.push(handler);
	}
	disconnect() {
		this.closed = true;
	}
	private check() {
		if (fakeRedis.down) this.closed = true;
		if (this.closed) throw new Error('Connection is closed.');
	}
	private read(key: string) {
		const entry = fakeRedis.values.get(key);
		return entry && entry.expiresAt > Date.now() ? entry.value : null;
	}
	async mget(keys: string[]) {
		this.check();
		return keys.map((key) => this.read(key));
	}
	async set(key: string, value: string, _ex: 'EX', seconds: number, nx?: 'NX') {
		this.check();
		if (nx && this.read(key) !== null) return null;
		fakeRedis.values.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
		return 'OK';
	}
	pipeline() {
		const queued: Array<[string, string, 'EX', number]> = [];
		const pipeline = {
			set: (...args: [string, string, 'EX', number]) => {
				queued.push(args);
				return pipeline;
			},
			exec: async () =>
				Promise.all(
					queued.map((args) =>
						this.set(...args).then(
							(result) =>
								fakeRedis.timedOut
									? [new Error('Command timed out'), null]
									: [null, result],
							(error) => [error, null]
						)
					)
				),
		};
		return pipeline;
	}
}
