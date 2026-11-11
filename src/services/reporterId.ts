export type ReportType = 'porn' | 'wrong_imdb' | 'wrong_season' | 'malware';

export const TAGGED = /^(pm|oc|dl|jev):(.+)$/s;

/**
 * The reporter a report is filed under once Jev agrees with it. Since 2026-11-11
 * that is a hint on /admin/reports, not a decision; a client must still never be
 * able to send it: `jev:` is a tag here, and `verifiedReporterId` never answers with it.
 */
export const JEV_REPORTER = 'jev:confirmed';

/** Filed when the model judged a report wrong: the release looks right for the title. */
export const JEV_DISPUTED = 'jev:disputed';

/** The model's own entries, never a person. */
export const isModelReporter = (userId: string) => userId.startsWith('jev:');
