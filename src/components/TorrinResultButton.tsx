import useLocalStorage from '@/hooks/localStorage';
import { addTorrinMagnet, selectTorrinFiles } from '@/services/torrin';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

export default function TorrinResultButton({
	hash,
	available,
}: {
	hash: string;
	available?: boolean;
}) {
	const [baseUrl] = useLocalStorage<string>('torrin:baseUrl');
	const [apiKey] = useLocalStorage<string>('torrin:apiKey');
	const [loading, setLoading] = useState(false);
	const [added, setAdded] = useState(false);

	if (!baseUrl || !apiKey) return null;

	const isReady = available || added;
	const cls = isReady
		? 'border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50'
		: 'border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50';

	const add = async () => {
		setLoading(true);
		try {
			const id = await addTorrinMagnet(baseUrl, apiKey, hash);
			await selectTorrinFiles(baseUrl, apiKey, id, 'all');
			setAdded(true);
			toast.success('Added to Torrin');
		} catch (e: any) {
			toast.error(`Torrin: ${e?.message ?? 'failed to add'}`);
		} finally {
			setLoading(false);
		}
	};

	return (
		<button
			className={`haptic-sm inline rounded border-2 px-1 text-xs transition-colors ${cls} ${loading ? 'cursor-not-allowed opacity-50' : ''}`}
			onClick={add}
			disabled={loading || isReady}
		>
			{loading ? (
				<Loader2 className="inline-block h-3 w-3 animate-spin" />
			) : isReady ? (
				'TR ✓'
			) : (
				'Add TR'
			)}
		</button>
	);
}
