import { Repository } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ message: 'Method not allowed' });
	}

	try {
		const { reports, userId, type } = req.body;

		if (!reports || !Array.isArray(reports) || reports.length === 0) {
			return res.status(400).json({ message: 'Invalid or empty reports array' });
		}

		if (!userId || !type) {
			return res.status(400).json({ message: 'Missing userId or type' });
		}

		// Validate report type
		if (!['porn', 'wrong_imdb', 'wrong_season'].includes(type)) {
			return res.status(400).json({ message: 'Invalid report type' });
		}

		// Validate each report has required fields
		const invalidReports = reports.filter((r) => !r.hash || !r.imdbId);
		if (invalidReports.length > 0) {
			return res.status(400).json({ message: 'Some reports are missing hash or imdbId' });
		}

		const repository = new Repository();
		const results = [];
		const errors = [];

		// Process each report
		for (const report of reports) {
			try {
				await repository.reportContent(
					report.hash,
					report.imdbId,
					userId,
					type as 'porn' | 'wrong_imdb' | 'wrong_season'
				);
				results.push({ hash: report.hash, success: true });
			} catch (error) {
				console.error(`Failed to report ${report.hash}:`, error);
				errors.push({
					hash: report.hash,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		}

		// Disconnect repository after all operations
		await repository.disconnect();

		return res.status(200).json({
			success: true,
			reported: results.length,
			failed: errors.length,
			errors: errors.length > 0 ? errors : undefined,
		});
	} catch (error) {
		console.error('Mass report error:', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
}
