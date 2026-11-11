import { AdminFetch, AdminLayout } from '@/components/admin/AdminLayout';
import type { AdminSetting } from '@/pages/api/admin/settings';
import { FormEvent, useCallback, useEffect, useState } from 'react';

const SOURCE_LABEL: Record<AdminSetting['source'], string> = {
	saved: 'Saved here',
	environment: 'From the environment',
	unset: 'Not set',
};

function SettingForm({
	setting,
	onSave,
}: {
	setting: AdminSetting;
	onSave: (method: 'PUT' | 'DELETE', key: string, value?: string) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const multiline = setting.key === 'torznabSponsorLimits';
	const run = async (method: 'PUT' | 'DELETE', value?: string) => {
		setBusy(true);
		try {
			await onSave(method, setting.key, value);
		} finally {
			setBusy(false);
		}
	};
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const value = new FormData(event.currentTarget).get('value')?.toString() ?? '';
		void run('PUT', value);
	};
	const shown = multiline ? setting.value.split(',').join('\n') : setting.value;
	const field =
		'w-full rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-sm text-gray-100';

	return (
		<form
			onSubmit={submit}
			className="rounded border-2 border-gray-600 bg-gray-800/30 p-4 text-sm text-gray-200"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-base font-semibold text-gray-100">{setting.label}</h2>
				<span className="text-xs text-gray-400">
					{SOURCE_LABEL[setting.source]}
					{setting.source !== 'saved' ? ` (${setting.env})` : ''}
				</span>
			</div>
			<p className="mt-1 text-xs text-gray-400">{setting.help}</p>
			{multiline ? (
				<textarea
					name="value"
					rows={4}
					defaultValue={shown}
					placeholder="SHORTID=5"
					className={`${field} mt-3 font-mono`}
				/>
			) : (
				<input
					name="value"
					type={setting.secret ? 'password' : 'text'}
					autoComplete="off"
					defaultValue={setting.secret ? '' : shown}
					placeholder={
						setting.secret && setting.value
							? `In use: ${setting.value}; type to replace`
							: ''
					}
					className={`${field} mt-3`}
				/>
			)}
			<div className="mt-3 flex flex-wrap justify-end gap-2">
				{setting.source === 'saved' ? (
					<button
						type="button"
						disabled={busy}
						onClick={() => void run('DELETE')}
						className="rounded border border-gray-600 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
					>
						Use {setting.env} again
					</button>
				) : null}
				<button
					disabled={busy}
					className="rounded bg-cyan-700 px-3 py-1 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
				>
					Save
				</button>
			</div>
		</form>
	);
}

function SiteSettings({ adminFetch }: { adminFetch: AdminFetch }) {
	const [settings, setSettings] = useState<AdminSetting[] | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await adminFetch('/api/admin/settings');
		if (!res.ok) {
			setSettings(null);
			if (res.status !== 401) setMessage(`Loading failed (${res.status}).`);
			return;
		}
		setSettings((await res.json()).settings);
	}, [adminFetch]);

	useEffect(() => {
		void load();
	}, [load]);

	const onSave = async (method: 'PUT' | 'DELETE', key: string, value?: string) => {
		const res = await adminFetch('/api/admin/settings', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key, value }),
		});
		const reply = await res.json().catch(() => ({}));
		if (!res.ok) {
			setMessage(reply.error ?? `Saving failed (${res.status}).`);
			return;
		}
		setMessage('Saved. Other DMM instances pick it up within 30 seconds.');
		await load();
	};

	return (
		<>
			{message ? <p className="text-sm text-yellow-300">{message}</p> : null}
			{settings?.map((setting) => (
				<SettingForm
					key={`${setting.key}:${setting.source}:${setting.value}`}
					setting={setting}
					onSave={onSave}
				/>
			))}
		</>
	);
}

export default function SettingsAdminPage() {
	return (
		<AdminLayout title="Site settings">
			{(adminFetch) => <SiteSettings adminFetch={adminFetch} />}
		</AdminLayout>
	);
}
