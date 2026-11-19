// Subtitle languages of search results, read from the probes zurg has stored for
// each release (TorrentSnapshot) and filtered with the `subs:` search token.
//
// ffprobe reports a track's language as its container tagged it: the ISO 639-2
// bibliographic code (gre), the terminological one (ell), a two-letter ISO 639-1
// code (el), sometimes with a region (pt-BR). Every form is folded into the
// bibliographic code languageEmojis is keyed by, so `subs:el`, `subs:ell` and
// `subs:gre` all match the same tracks.

/** ISO 639-2/T codes that differ from their 639-2/B twin. */
const TERMINOLOGICAL_TO_BIBLIOGRAPHIC: Record<string, string> = {
	bod: 'tib',
	ces: 'cze',
	cym: 'wel',
	deu: 'ger',
	ell: 'gre',
	eus: 'baq',
	fas: 'per',
	fra: 'fre',
	hye: 'arm',
	isl: 'ice',
	kat: 'geo',
	mkd: 'mac',
	mri: 'mao',
	msa: 'may',
	mya: 'bur',
	nld: 'dut',
	ron: 'rum',
	slk: 'slo',
	sqi: 'alb',
	zho: 'chi',
};

/** ISO 639-1 codes to ISO 639-2/B. */
const TWO_LETTER_TO_BIBLIOGRAPHIC: Record<string, string> = {
	af: 'afr',
	am: 'amh',
	ar: 'ara',
	az: 'aze',
	be: 'bel',
	bg: 'bul',
	bn: 'ben',
	bo: 'tib',
	bs: 'bos',
	ca: 'cat',
	cs: 'cze',
	cy: 'wel',
	da: 'dan',
	de: 'ger',
	el: 'gre',
	en: 'eng',
	eo: 'epo',
	es: 'spa',
	et: 'est',
	eu: 'baq',
	fa: 'per',
	fi: 'fin',
	fil: 'tgl',
	fr: 'fre',
	ga: 'gle',
	gl: 'glg',
	gu: 'guj',
	he: 'heb',
	hi: 'hin',
	hr: 'hrv',
	hu: 'hun',
	hy: 'arm',
	id: 'ind',
	is: 'ice',
	it: 'ita',
	ja: 'jpn',
	ka: 'geo',
	kk: 'kaz',
	km: 'khm',
	kn: 'kan',
	ko: 'kor',
	ku: 'kur',
	la: 'lat',
	lo: 'lao',
	lt: 'lit',
	lv: 'lav',
	mi: 'mao',
	mk: 'mac',
	ml: 'mal',
	mn: 'mon',
	mr: 'mar',
	ms: 'may',
	mt: 'mlt',
	my: 'bur',
	nb: 'nob',
	ne: 'nep',
	nl: 'dut',
	nn: 'nno',
	no: 'nor',
	pa: 'pan',
	pl: 'pol',
	ps: 'pus',
	pt: 'por',
	ro: 'rum',
	ru: 'rus',
	si: 'sin',
	sk: 'slo',
	sl: 'slv',
	so: 'som',
	sq: 'alb',
	sr: 'srp',
	sv: 'swe',
	sw: 'swa',
	ta: 'tam',
	te: 'tel',
	tg: 'tgk',
	th: 'tha',
	tl: 'tgl',
	tr: 'tur',
	uk: 'ukr',
	ur: 'urd',
	uz: 'uzb',
	vi: 'vie',
	yi: 'yid',
	zh: 'chi',
	zu: 'zul',
};

/** Tags that say the track's language is not known. */
const UNTAGGED = new Set(['und', 'unk', 'mis', 'mul', 'zxx', 'xx', '']);

/**
 * A language tag as the ISO 639-2/B code languageEmojis uses, or null for a tag
 * that names no language (und, unknown) or is not a language code at all.
 */
export function normalizeLanguage(tag: string): string | null {
	const code = tag.trim().toLowerCase().split(/[-_]/)[0];
	if (UNTAGGED.has(code) || !/^[a-z]{2,3}$/.test(code)) return null;
	if (code.length === 2 || code === 'fil') return TWO_LETTER_TO_BIBLIOGRAPHIC[code] ?? null;
	return TERMINOLOGICAL_TO_BIBLIOGRAPHIC[code] ?? code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The tagged subtitle languages across every probed file of one release, as
 * /api/library/mediainfo answers it (`releases[hash]`). A pack is the union of its
 * files: a flag means at least one probed file carries that track, not every episode.
 * Untagged tracks name no language and are left out.
 */
export function subtitleLanguagesOfRelease(release: unknown): string[] {
	const languages = new Set<string>();
	const files = isRecord(release) && isRecord(release.files) ? release.files : {};
	for (const file of Object.values(files)) {
		const streams =
			isRecord(file) && isRecord(file.MediaInfo) && Array.isArray(file.MediaInfo.streams)
				? file.MediaInfo.streams
				: [];
		for (const stream of streams) {
			if (!isRecord(stream) || stream.codec_type !== 'subtitle') continue;
			const tag = isRecord(stream.tags) ? stream.tags.language : undefined;
			const language = typeof tag === 'string' ? normalizeLanguage(tag) : null;
			if (language) languages.add(language);
		}
	}
	return [...languages].sort();
}

const SUBS_TOKEN = /^-?subs:/i;

/** Whether a search query holds a `subs:` term (negated or not). */
export function hasSubsToken(query: string): boolean {
	return query.split(/\s+/).some((term) => SUBS_TOKEN.test(term));
}

/** The query without its `subs:` terms, to count what the other terms leave. */
export function withoutSubsTokens(query: string): string {
	return query
		.split(/\s+/)
		.filter((term) => term && !SUBS_TOKEN.test(term))
		.join(' ');
}

/**
 * Known subtitle languages by lowercase hash. A hash absent from the map is
 * unknown: no zurg user has posted a probe of it, which says nothing about
 * whether it has subtitles. A hash mapped to [] was probed and has no tagged track.
 */
export type SubtitleLanguageMap = ReadonlyMap<string, readonly string[]>;
