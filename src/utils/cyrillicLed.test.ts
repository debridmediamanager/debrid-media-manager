import recorded from '@/test/fixtures/scraped/cyrillic-led-pages-2026-10-07.json';
import { describe, expect, it } from 'vitest';
import { cyrillicLedLast, isCyrillicLed } from './cyrillicLed';

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

describe('cyrillicLedLast on The Vexxer (card 248)', () => {
	const vexxer = (
		recorded.pages.find((p) => p.key === 'movie:tt0446009')!.value as {
			hash: string;
			title: string;
			fileSize: number;
		}[]
	).toSorted((a, b) => b.fileSize - a.fileSize);

	it('moves the releases named in Russian after the rest and keeps each group in order', () => {
		expect(cyrillicLedLast(vexxer).map((r) => r.hash.slice(0, 8))).toEqual([
			'3e00e70c',
			'9e3a5ffc',
			'99ff6a2d',
			'c847f15e',
			'fb1d2b7a',
			'453bb1ca',
			'51cda441',
			'7688ea77',
			'75197031',
			'8c997e30',
			'e61e15e5',
		]);
	});

	it('hands back the same list when nothing is named in Russian', () => {
		const latin = vexxer.filter((r) => !isCyrillicLed(r.title));
		expect(cyrillicLedLast(latin)).toBe(latin);
	});
});
