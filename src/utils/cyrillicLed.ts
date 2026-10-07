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
