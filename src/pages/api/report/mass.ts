import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiRequest, NextApiResponse } from 'next';

const MAX_REPORTS_PER_REQUEST = 100;

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ message: 'Method not allowed' });
	}

	try {
		const { reports, userId, type, dmmProblemKey, solution } = req.body;

		// Checked before the payload validation so an unauthenticated caller
		// cannot use the 400s to probe what this endpoint accepts. The IP rate
		// limit below was the only gate here, and one request became one DB write
		// per element of an unbounded array.
		if (
			!dmmProblemKey ||
			!(typeof dmmProblemKey === 'string') ||
			!solution ||
			!(typeof solution === 'string')
		) {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		}
		if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}

		if (!reports || !Array.isArray(reports) || reports.length === 0) {
			return res.status(400).json({ message: 'Invalid or empty reports array' });
		}

		// Same cap the availability endpoints use, so a single rate-limited
		// request cannot fan out into an unbounded number of DB writes.
		if (reports.length > MAX_REPORTS_PER_REQUEST) {
			return res
				.status(400)
				.json({ message: `Maximum ${MAX_REPORTS_PER_REQUEST} reports allowed` });
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

		const db = repository;
		const results = [];
		const errors = [];

		// Process each report
		for (const report of reports) {
			try {
				await db.reportContent(
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

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.report);
