import { cachedRead } from '@/services/cachedRead';

// Site settings changed at /admin/settings. Each one names the environment variable
// it replaces: while a setting has no row, that variable still applies, so moving a
// setting here changes nothing until someone saves it.

export interface SiteSettingSpec {
	label: string;
	help: string;
	env: string;
	/** Holds a credential: the admin API never sends it back. */
	secret?: boolean;
	/** The value as stored, or why it was refused. */
	parse(raw: string): { value: string } | { error: string };
}

const SPONSOR_LIMIT = /^([A-Za-z0-9]{1,16})\s*=\s*(\d{1,6})$/;

export const SITE_SETTINGS = {
	verdictsDailyTokens: {
		label: 'Verdict model budget, tokens per UTC day',
		help: 'Spending cap for the model that judges scraped results and reports, across every instance. Unset: 11,000,000.',
		env: 'SCRAPED_VERDICTS_DAILY_TOKENS',
		parse(raw) {
			const value = Number(raw.trim().replace(/[,_ ]/g, ''));
			return Number.isInteger(value) && value > 0 && value <= 10_000_000_000
				? { value: String(value) }
				: { error: 'The budget is a whole number of tokens above 0' };
		},
	},
	torznabSponsorLimits: {
		label: 'Torznab searches per minute, per sponsor',
		help: 'One SHORTID=N per line, to slow down a key that sweeps the library around the clock. Only ever lowers the usual limit.',
		env: 'TORZNAB_SPONSOR_LIMITS',
		parse(raw) {
			const entries = raw
				.split(/[,\n]/)
				.map((entry) => entry.trim())
				.filter(Boolean);
			const out: string[] = [];
			for (const entry of entries) {
				const match = SPONSOR_LIMIT.exec(entry);
				if (!match || Number(match[2]) < 1) {
					return { error: `"${entry.slice(0, 40)}" is not SHORTID=N with N above 0` };
				}
				out.push(`${match[1]}=${Number(match[2])}`);
			}
			return { value: out.join(',') };
		},
	},
	inspectPremiumizeKey: {
		label: 'Premiumize key for looking inside reported releases',
		help: "Lists a reported torrent's files and plays them at /admin/reports (directdl: nothing is added to the account). Use a test account.",
		env: 'INSPECT_PREMIUMIZE_KEY',
		secret: true,
		parse(raw) {
			const value = raw.trim();
			return /^[A-Za-z0-9]{8,64}$/.test(value)
				? { value }
				: { error: 'A Premiumize API key is 8 to 64 letters and digits' };
		},
	},
	aiostreamsUrl: {
		label: 'AIOStreams addon URL',
		help: 'The configuration URL (…/stremio/<uuid>/<password>, a manifest.json paste works). http only for an instance on the tailnet.',
		env: 'AIOSTREAMS_URL',
		secret: true,
		parse(raw) {
			const value = raw.trim();
			return /^https?:\/\/[^\s/]+\/\S+$/.test(value) && value.length <= 1000
				? { value }
				: { error: 'The URL is the full http(s) addon address' };
		},
	},
} satisfies Record<string, SiteSettingSpec>;

export type SiteSettingKey = keyof typeof SITE_SETTINGS;

export const isSiteSettingKey = (key: unknown): key is SiteSettingKey =>
	typeof key === 'string' && Object.hasOwn(SITE_SETTINGS, key);

export const SITE_SETTINGS_TTL_MS = 30_000;

const stored = cachedRead<Map<string, string>>(
	async () => {
		const { SiteSettingService } = await import('@/services/database/siteSettings');
		const rows = await new SiteSettingService().listSettings();
		return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.key, row.value]));
	},
	new Map(),
	SITE_SETTINGS_TTL_MS,
	'Site settings'
);

/** The saved value, else the environment variable's, else ''. Re-read at most every 30 s. */
export async function getSiteSetting(key: SiteSettingKey): Promise<string> {
	return (await stored.get()).get(key) ?? process.env[SITE_SETTINGS[key].env] ?? '';
}

/** Where each setting currently comes from, for the admin page. */
export async function siteSettingSources(): Promise<Map<string, string>> {
	return stored.get();
}

export const invalidateSiteSettings = () => stored.invalidate();
export const _resetSiteSettingsForTest = () => stored.resetForTest();
