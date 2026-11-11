import { SiteSettingService } from '@/services/database/siteSettings';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { invalidateSiteSettings, isSiteSettingKey, SITE_SETTINGS } from '@/services/siteSettings';
import { isAdmin } from '@/utils/adminToken';
import { NextApiHandler } from 'next';

// Site settings for /admin/settings. GET lists them, PUT saves one, DELETE puts one back
// on its environment variable. A secret setting's value never comes back out.

export type AdminSetting = {
	key: string;
	label: string;
	help: string;
	env: string;
	secret: boolean;
	/** Where the value in use comes from. */
	source: 'saved' | 'environment' | 'unset';
	/** The value in use; for a secret, only its host and last three characters. */
	value: string;
};

const hint = (value: string) => {
	try {
		return `${new URL(value).origin}/…${value.slice(-3)}`;
	} catch {
		return '…';
	}
};

let service: SiteSettingService | null = null;

const handler: NextApiHandler = async (req, res) => {
	if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
	res.setHeader('Cache-Control', 'no-store');
	service ??= new SiteSettingService();

	if (req.method === 'GET') {
		const saved = new Map((await service.listSettings()).map((row) => [row.key, row.value]));
		const settings: AdminSetting[] = Object.entries(SITE_SETTINGS).map(([key, spec]) => {
			const envValue = process.env[spec.env] ?? '';
			const value = saved.get(key) ?? envValue;
			const secret = 'secret' in spec && spec.secret === true;
			return {
				key,
				label: spec.label,
				help: spec.help,
				env: spec.env,
				secret,
				source: saved.has(key) ? 'saved' : envValue ? 'environment' : 'unset',
				value: secret && value ? hint(value) : value,
			};
		});
		return res.status(200).json({ settings });
	}

	if (req.method !== 'PUT' && req.method !== 'DELETE') {
		res.setHeader('Allow', 'GET, PUT, DELETE');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const { key, value } = req.body ?? {};
	if (!isSiteSettingKey(key)) return res.status(400).json({ error: 'Unknown setting' });

	if (req.method === 'DELETE') {
		await service.removeSetting(key);
	} else {
		if (typeof value !== 'string')
			return res.status(400).json({ error: 'Send the value as text' });
		const parsed = SITE_SETTINGS[key].parse(value);
		if ('error' in parsed) return res.status(400).json({ error: parsed.error });
		await service.setSetting(key, parsed.value);
	}
	invalidateSiteSettings();
	return res.status(200).json({ ok: true });
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.admin);
