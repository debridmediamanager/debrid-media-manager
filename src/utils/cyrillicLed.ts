/**
 * A release whose name starts with a Cyrillic letter.
 *
 * In the trusted library these are the title's own releases under a Russian
 * name: "Безумцы из Скотланд-ярда / The Vexxer / Neues vom Wixxer [2007 BDRemux
 * 1080p] Dub (DVD) ...", "Мосгаз. Дело №10. Метроном.S10.(2024).WEBRip". So the
 * title pages list them (card 248). They are Russian-language releases, a dub or
 * voice-over of a foreign film or a Russian production, so nothing picks one for
 * a viewer who has not read its name: the page's one-click buttons, the Stremio
 * addons, the Torznab feed and zurg's search all skip them. On 2026-10-07 the
 * largest RD-cached trusted release was one of these on 5,455 movie pages.
 *
 * The untrusted table's paged read drops them outright (`cyrillicLedDropped`).
 */
export const CYRILLIC_LED = /^[А-Яа-яЁё]/;

export const isCyrillicLed = (title: string): boolean => CYRILLIC_LED.test(title);

/**
 * The listed results with Cyrillic-led releases moved after the rest, each group
 * keeping the order it had. A page sorts cached and biggest first, which put the
 * Russian-dub BDRemux at the top of The Vexxer and LostFilm's remux at the top of
 * Mad Men season 2 once the pages listed them.
 */
export function cyrillicLedLast<T extends { title: string }>(results: T[]): T[] {
	const rest: T[] = [];
	const cyrillicLed: T[] = [];
	for (const result of results) (isCyrillicLed(result.title) ? cyrillicLed : rest).push(result);
	return cyrillicLed.length === 0 ? results : [...rest, ...cyrillicLed];
}
