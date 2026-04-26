/**
 * Unified rate limiter for all debrid services
 * Implements Zurg's rate limiting patterns with browser adaptations
 */
import { delay } from '@/utils/delay';

interface RateLimitConfig {
	maxRequestsPerMinute: number;
	maxConcurrent: number;
	retryAttempts: number;
	backoffMultiplier: number;
	jitterRange: number; // 0-1, percentage of jitter to add
	burstSize?: number; // Allow burst of requests
}

interface QueuedRequest<T> {
	id: string;
	execute: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: any) => void;
	retryCount: number;
	priority: number;
	timestamp: number;
}

export class UnifiedRateLimiter {
	private configs: Map<string, RateLimitConfig> = new Map();
	private queues: Map<string, QueuedRequest<any>[]> = new Map();
	private activeRequests: Map<string, number> = new Map();
	private requestTimestamps: Map<string, number[]> = new Map();
	private lastRequestTime: Map<string, number> = new Map();
	private processing: Map<string, boolean> = new Map();
	private tokenBuckets: Map<string, { tokens: number; lastRefill: number }> = new Map();

	constructor() {
		// Initialize default configs for each service (like Zurg's rate limiters)
		this.configs.set('realdebrid', {
			maxRequestsPerMinute: 250,
			maxConcurrent: 3,
			retryAttempts: 7,
			backoffMultiplier: 2,
			jitterRange: 0.2,
			burstSize: 10,
		});

		this.configs.set('alldebrid', {
			maxRequestsPerMinute: 300,
			maxConcurrent: 5,
			retryAttempts: 5,
			backoffMultiplier: 1.5,
			jitterRange: 0.3,
			burstSize: 15,
		});

		this.configs.set('torbox', {
			maxRequestsPerMinute: 500,
			maxConcurrent: 8,
			retryAttempts: 10,
			backoffMultiplier: 2,
			jitterRange: 0.2,
			burstSize: 20,
		});

		// Initialize structures for each service
		for (const service of this.configs.keys()) {
			this.queues.set(service, []);
			this.activeRequests.set(service, 0);
			this.requestTimestamps.set(service, []);
			this.lastRequestTime.set(service, 0);
			this.processing.set(service, false);
			const config = this.configs.get(service)!;
			this.tokenBuckets.set(service, {
				tokens: config.burstSize || config.maxConcurrent,
				lastRefill: Date.now(),
			});
		}
	}

	/**
	 * Update configuration for a specific service
	 */
	updateConfig(service: string, config: Partial<RateLimitConfig>): void {
		const existing = this.configs.get(service);
		if (existing) {
			this.configs.set(service, { ...existing, ...config });
		}
	}

	/**
	 * Execute a request with rate limiting and retry logic
	 */
	async execute<T>(
		service: string,
		requestId: string,
		requestFn: () => Promise<T>,
		priority: number = 0
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const request: QueuedRequest<T> = {
				id: requestId,
				execute: requestFn,
				resolve,
				reject,
				retryCount: 0,
				priority,
				timestamp: Date.now(),
			};

			this.enqueue(service, request);
		});
	}

	/**
	 * Execute multiple requests in parallel with controlled concurrency
	 * Similar to Zurg's parallel torrent fetching
	 */
	async executeBatch<T>(
		service: string,
		requests: Array<{
			id: string;
			fn: () => Promise<T>;
			priority?: number;
		}>
	): Promise<Map<string, T | Error>> {
		const results = new Map<string, T | Error>();
		const promises = requests.map(({ id, fn, priority = 0 }) =>
			this.execute(service, id, fn, priority)
				.then((result) => {
					results.set(id, result);
				})
				.catch((error) => {
					results.set(id, error);
				})
		);

		await Promise.allSettled(promises);
		return results;
	}

	private enqueue<T>(service: string, request: QueuedRequest<T>): void {
		const queue = this.queues.get(service);
		if (!queue) {
			request.reject(new Error(`Unknown service: ${service}`));
			return;
		}

		// Insert based on priority (higher priority first)
		const insertIndex = queue.findIndex((r) => r.priority < request.priority);
		if (insertIndex === -1) {
			queue.push(request);
		} else {
			queue.splice(insertIndex, 0, request);
		}

		this.processQueue(service);
	}

	private async processQueue(service: string): Promise<void> {
		// Prevent concurrent processing for the same service
		if (this.processing.get(service)) {
			return;
		}
		this.processing.set(service, true);

		try {
			const config = this.configs.get(service);
			const queue = this.queues.get(service);
			const activeCount = this.activeRequests.get(service) || 0;

			if (!config || !queue || queue.length === 0) {
				return;
			}

			// Process requests while respecting concurrency and rate limits
			while (queue.length > 0 && activeCount < config.maxConcurrent) {
				if (!(await this.canMakeRequest(service))) {
					// Wait before checking again
					const delay = this.getDelayUntilNextRequest(service);
					if (delay > 0) {
						await this.sleep(delay);
					}
					continue;
				}

				const request = queue.shift();
				if (!request) break;

				this.executeRequest(service, request);
			}
		} finally {
			this.processing.set(service, false);

			// Check if there are more requests to process
			const queue = this.queues.get(service);
			if (queue && queue.length > 0) {
				// Schedule next processing cycle
				delay(10).then(() => this.processQueue(service));
			}
		}
	}

	private async executeRequest<T>(service: string, request: QueuedRequest<T>): Promise<void> {
		const config = this.configs.get(service)!;
		const activeCount = this.activeRequests.get(service) || 0;
		this.activeRequests.set(service, activeCount + 1);

		// Record request timestamp
		const timestamps = this.requestTimestamps.get(service) || [];
		timestamps.push(Date.now());
		// Keep only timestamps from last minute
		const oneMinuteAgo = Date.now() - 60000;
		this.requestTimestamps.set(
			service,
			timestamps.filter((t) => t > oneMinuteAgo)
		);
		this.lastRequestTime.set(service, Date.now());

		try {
			const result = await this.executeWithRetry(service, request);
			request.resolve(result);
		} catch (error) {
			request.reject(error);
		} finally {
			const currentActive = this.activeRequests.get(service) || 1;
			this.activeRequests.set(service, Math.max(0, currentActive - 1));

			// Process more requests
			this.processQueue(service);
		}
	}

	private async executeWithRetry<T>(service: string, request: QueuedRequest<T>): Promise<T> {
		const config = this.configs.get(service)!;
		let lastError: any;

		while (request.retryCount <= config.retryAttempts) {
			try {
				const result = await request.execute();
				return result;
			} catch (error: any) {
				lastError = error;

				// Check if error is retryable
				if (!this.isRetryableError(error)) {
					throw error;
				}

				// Check if we've exceeded retry attempts
				if (request.retryCount >= config.retryAttempts) {
					throw error;
				}

				// Calculate backoff delay with jitter (like Zurg)
				const baseDelay = Math.pow(config.backoffMultiplier, request.retryCount) * 1000;
				const jitter = 1 + (Math.random() - 0.5) * config.jitterRange;
				const delay = Math.min(baseDelay * jitter, 60000); // Cap at 60 seconds

				console.log(
					`[${service}] Retry ${request.retryCount + 1}/${config.retryAttempts} for ${
						request.id
					} after ${Math.round(delay)}ms`
				);

				request.retryCount++;
				await this.sleep(delay);

				// If it's a 429 error, wait for rate limit to reset
				if (error.response?.status === 429) {
					const resetDelay = this.getResetDelay(error);
					if (resetDelay > 0) {
						await this.sleep(resetDelay);
					}
				}
			}
		}

		throw lastError;
	}

	private async canMakeRequest(service: string): Promise<boolean> {
		const config = this.configs.get(service)!;

		// Token bucket algorithm for burst support
		const bucket = this.tokenBuckets.get(service)!;
		const now = Date.now();
		const timeSinceRefill = now - bucket.lastRefill;
		const refillRate = config.maxRequestsPerMinute / 60000; // tokens per ms
		const tokensToAdd = Math.min(
			timeSinceRefill * refillRate,
			(config.burstSize || config.maxConcurrent) - bucket.tokens
		);

		if (tokensToAdd > 0) {
			bucket.tokens += tokensToAdd;
			bucket.lastRefill = now;
		}

		if (bucket.tokens < 1) {
			return false;
		}

		// Check rate limit
		const timestamps = this.requestTimestamps.get(service) || [];
		const oneMinuteAgo = now - 60000;
		const recentRequests = timestamps.filter((t) => t > oneMinuteAgo).length;

		if (recentRequests >= config.maxRequestsPerMinute) {
			return false;
		}

		// Check minimum interval between requests
		const lastRequest = this.lastRequestTime.get(service) || 0;
		const minInterval = 60000 / config.maxRequestsPerMinute;
		if (now - lastRequest < minInterval) {
			return false;
		}

		// Consume a token
		bucket.tokens = Math.max(0, bucket.tokens - 1);
		return true;
	}

	private getDelayUntilNextRequest(service: string): number {
		const config = this.configs.get(service)!;
		const now = Date.now();

		// Check based on timestamps
		const timestamps = this.requestTimestamps.get(service) || [];
		const oneMinuteAgo = now - 60000;
		const recentTimestamps = timestamps.filter((t) => t > oneMinuteAgo);

		if (recentTimestamps.length >= config.maxRequestsPerMinute) {
			// Find the oldest timestamp that needs to expire
			const oldestRelevant = recentTimestamps[0];
			return Math.max(0, oldestRelevant + 60000 - now);
		}

		// Check minimum interval
		const lastRequest = this.lastRequestTime.get(service) || 0;
		const minInterval = 60000 / config.maxRequestsPerMinute;
		return Math.max(0, lastRequest + minInterval - now);
	}

	private isRetryableError(error: any): boolean {
		if (!error.response) {
			// Network errors are retryable
			return true;
		}

		const status = error.response.status;
		// Retry on rate limit, server errors, and specific client errors
		return (
			status === 429 || (status >= 500 && status < 600) || status === 408 || status === 425
		);
	}

	private getResetDelay(error: any): number {
		// Try to parse Retry-After header
		const retryAfter = error.response?.headers?.['retry-after'];
		if (retryAfter) {
			const seconds = parseInt(retryAfter, 10);
			if (!isNaN(seconds)) {
				return seconds * 1000;
			}
		}

		// Try to parse X-RateLimit-Reset header
		const resetTime = error.response?.headers?.['x-ratelimit-reset'];
		if (resetTime) {
			const resetTimestamp = parseInt(resetTime, 10) * 1000;
			if (!isNaN(resetTimestamp)) {
				return Math.max(0, resetTimestamp - Date.now());
			}
		}

		// Default to 60 seconds if no header found
		return 60000;
	}

	private sleep(ms: number): Promise<void> {
		return delay(ms);
	}

	/**
	 * Get current queue statistics
	 */
	getStats(service?: string): any {
		if (service) {
			return {
				queueLength: this.queues.get(service)?.length || 0,
				activeRequests: this.activeRequests.get(service) || 0,
				recentRequests: this.requestTimestamps.get(service)?.length || 0,
				tokens: this.tokenBuckets.get(service)?.tokens || 0,
			};
		}

		const stats: any = {};
		for (const [svc, config] of this.configs) {
			stats[svc] = {
				queueLength: this.queues.get(svc)?.length || 0,
				activeRequests: this.activeRequests.get(svc) || 0,
				recentRequests: this.requestTimestamps.get(svc)?.length || 0,
				tokens: this.tokenBuckets.get(svc)?.tokens || 0,
				config,
			};
		}
		return stats;
	}

	/**
	 * Clear all queues and reset state
	 */
	reset(service?: string): void {
		if (service) {
			this.queues.set(service, []);
			this.activeRequests.set(service, 0);
			this.requestTimestamps.set(service, []);
			this.lastRequestTime.set(service, 0);
			const config = this.configs.get(service)!;
			this.tokenBuckets.set(service, {
				tokens: config.burstSize || config.maxConcurrent,
				lastRefill: Date.now(),
			});
		} else {
			for (const svc of this.configs.keys()) {
				this.reset(svc);
			}
		}
	}
}

// Global singleton instance
let globalRateLimiter: UnifiedRateLimiter | null = null;

export function getGlobalRateLimiter(): UnifiedRateLimiter {
	if (!globalRateLimiter) {
		globalRateLimiter = new UnifiedRateLimiter();
	}
	return globalRateLimiter;
}
