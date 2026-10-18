export type ReportType = 'porn' | 'wrong_imdb' | 'wrong_season' | 'malware';

export const TAGGED = /^(pm|oc|dl|jev):(.+)$/s;

/**
 * The reporter a report is filed under once Jev agrees with it. One such report
 * hides the result, so a client must never be able to send it: `jev:` is a tag
 * here, and `verifiedReporterId` never answers with it.
 */
export const JEV_REPORTER = 'jev:confirmed';
