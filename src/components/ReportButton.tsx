import axios from 'axios';
import { useState } from 'react';
import toast from 'react-hot-toast';

type ReportButtonProps = {
	hash: string;
	imdbId: string;
	userId: string;
	isShow?: boolean;
};

export default function ReportButton({ hash, imdbId, userId, isShow }: ReportButtonProps) {
	const [showDialog, setShowDialog] = useState(false);

	const handleReport = async (type: string) => {
		try {
			await axios.post('/api/report', {
				hash,
				imdbId,
				userId,
				type,
			});
			toast.success('Content reported successfully');
		} catch (error) {
			console.error('Report error:', error);
			toast.error('Failed to report content');
		} finally {
			setShowDialog(false);
		}
	};

	return (
		<>
			<button
				onClick={() => setShowDialog(true)}
				className="haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50"
			>
				⚠️ Report
			</button>

			{showDialog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					<div
						className="fixed inset-0 bg-black opacity-50"
						onClick={() => setShowDialog(false)}
					></div>
					<div className="relative z-50 w-80 rounded-lg bg-gray-800 p-4 shadow-xl">
						<h3 className="mb-4 text-lg font-bold text-gray-100">Report Content</h3>
						<div className="space-y-2">
							<button
								onClick={() => handleReport('porn')}
								className="haptic-sm block w-full rounded border-2 border-red-500 bg-red-900/30 px-4 py-2 text-left text-sm text-red-100 transition-colors hover:bg-red-800/50"
							>
								XXX / Porn Content
							</button>
							<button
								onClick={() => handleReport('wrong_imdb')}
								className="haptic-sm block w-full rounded border-2 border-red-500 bg-red-900/30 px-4 py-2 text-left text-sm text-red-100 transition-colors hover:bg-red-800/50"
							>
								Incorrect IMDB ID
							</button>
							{isShow && (
								<button
									onClick={() => handleReport('wrong_season')}
									className="haptic-sm block w-full rounded border-2 border-red-500 bg-red-900/30 px-4 py-2 text-left text-sm text-red-100 transition-colors hover:bg-red-800/50"
								>
									Tagged for Wrong Season
								</button>
							)}
							<button
								onClick={() => setShowDialog(false)}
								className="haptic-sm mt-4 block w-full rounded border-2 border-gray-500 bg-gray-900/30 px-4 py-2 text-sm text-gray-100 transition-colors hover:bg-gray-800/50"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
