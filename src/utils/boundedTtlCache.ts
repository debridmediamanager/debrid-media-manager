/**
 * An in-process memo with a lifetime per entry and a ceiling on its size.
 *
 * A plain object keyed by user input grows by one entry per distinct input for
 * the life of the process, and never forgets an answer that has gone stale.
 * Insertion order doubles as recency here: a hit is re-inserted at the end, so
 * when the map is full the entry at the front is the least recently used.
 */
export class BoundedTtlCache<V> {
	private readonly entries = new Map<string, { value: V; expiresAt: number }>();

	constructor(
		private readonly ttlMs: number,
		private readonly maxEntries: number,
		private readonly now: () => number = Date.now
	) {
		if (!(ttlMs > 0) || !Number.isInteger(maxEntries) || maxEntries < 1) {
			throw new Error('BoundedTtlCache needs a positive TTL and entry limit');
		}
	}

	get(key: string): V | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		this.entries.delete(key);
		if (entry.expiresAt <= this.now()) return undefined;
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: V): void {
		this.entries.delete(key);
		while (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next().value as string;
			this.entries.delete(oldest);
		}
		this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
	}

	get size(): number {
		return this.entries.size;
	}
}
