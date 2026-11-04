import Redis from 'ioredis';

/**
 * How many DMM Cast installs use each client, per day and provider.
 *
 * Each stream list adds its cast id to a Redis HyperLogLog keyed
 * `telemetry:cast:<UTC day>:<client>:<provider>`, so the counts are distinct
 * installs while no id is stored or can be read back. An install is a cast id:
 * one id on two devices with the same client counts once. Read by the
 * workspace's install-report.sh on dmm-01.
 *
 * Best effort: telemetry must never slow or fail a stream list, so nothing is
 * awaited by the caller and every error is swallowed.
 */

export const CAST_TELEMETRY_TTL_SECONDS = 120 * 24 * 60 * 60;

/**
 * The client family a User-Agent names. The cast URLs are shared beyond
 * Stremio's apps (AIOStreams, Nuvio, cli_debrid...), so anything else is named
 * by its first product token rather than lumped together.
 */
export function castClient(userAgent: string | undefined): string {
	const ua = (userAgent ?? '').trim();
	// Every Kodi addon up to 1.1.1 sent a fixed `DMM-Kodi/1.0`; later ones send their version.
	const kodi = /^DMM-Kodi\/([0-9][0-9.]{0,15})/.exec(ua);
	if (kodi) return `kodi/${kodi[1]}`;
	if (/Stremio/i.test(ua)) return 'stremio';
	// Stremio Web and the Stremio apps for Tizen and webOS run in a browser engine.
	if (ua.startsWith('Mozilla/')) return 'browser';
	const token = /^[A-Za-z][A-Za-z0-9_.-]*/.exec(ua)?.[0].toLowerCase().slice(0, 24);
	return token || 'unknown';
}

export function castTelemetryKey(client: string, provider: string, now: Date): string {
	return `telemetry:cast:${now.toISOString().slice(0, 10)}:${client}:${provider}`;
}

let redis: Redis | null = null;

export function recordCastUse(
	provider: string,
	castId: string,
	userAgent: string | undefined,
	now = new Date()
): void {
	if (!process.env.REDIS_URL) return;
	if (!redis) {
		redis = new Redis(process.env.REDIS_URL, {
			maxRetriesPerRequest: 1,
			connectTimeout: 2000,
			commandTimeout: 1000,
			lazyConnect: true,
		});
		redis.on('error', () => {}); // an unhandled 'error' event would crash the process
	}
	const key = castTelemetryKey(castClient(userAgent), provider, now);
	redis
		.multi()
		.pfadd(key, castId)
		.expire(key, CAST_TELEMETRY_TTL_SECONDS)
		.exec()
		.catch(() => {});
}
