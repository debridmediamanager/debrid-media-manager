import recorded from '@/test/fixtures/scraped/cyrillic-led-pages-2026-10-07.json';
import { describe, expect, it } from 'vitest';
import { isCyrillicLed } from './cyrillicLed';

const titles = recorded.pages.flatMap((page) =>
	(page.value as { title?: string; filename?: string }[]).map((r) => r.title ?? r.filename!)
);

describe('isCyrillicLed on the recorded pages (card 248)', () => {
	it.each([
		"Дораэмон Битва против Короля Русалок Eiga Doraemon Nobita no Ningyo Daikaisen Doraemon Nobita's Great Battle of the Mermaid King Doraemon Movie 30 Nobita no Ningyo Daikaisen Новый Дораэмон (фильм пятый) [Movie] [JAP+Sub] [2010, приключения, кодомо, DV",
		'Мосгаз. Дело №10. Метроном.S10.(2024).WEBRip.(AVC).Files-x',
		'Письмо для Момо / Momo e no tegami (2011) BDRip 720p | D',
		'Безумцы из Скотланд-ярда / The Vexxer / Neues vom Wixxer [2007 BDRemux 1080p] Dub (DVD) + AVO (Ю.Сербин) + Original (Deu) + Sub (Rus Deu)',
	])('names %s in Russian first', (title) => {
		expect(titles).toContain(title);
		expect(isCyrillicLed(title)).toBe(true);
	});

	it.each([
		"Doraemon.Nobita's.Great.Battle.of.the.Mermaid.King.2010.720p.DTS.x264-CHD",
		'哆啦A梦：大雄的人鱼大海战.Doraemon the Movie Nobita&#039;s Mermaid Legend 2010 480p DVDRip x264 AAC-YGSUB',
		'Neues.vom.Wixxer.2007.720p.BluRay.2xRus.3xGer.HDCLUB.mkv',
		'Joto Kando Kolkatatei (2025) 1080p ZEE5 WEB-DL DDP5 1 H 264-D3BP4A mkv',
	])('does not count %s', (title) => {
		expect(titles).toContain(title);
		expect(isCyrillicLed(title)).toBe(false);
	});
});
