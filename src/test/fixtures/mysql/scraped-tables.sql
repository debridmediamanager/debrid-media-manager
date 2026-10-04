-- SHOW CREATE TABLE on dmmdb (MySQL 8.0.36), read 2026-10-04 in a read-only session.
-- The server runs InnoDB at REPEATABLE-READ with innodb_lock_wait_timeout 50 and
-- deadlock detection on. Statements are separated by a line holding only ";".
CREATE TABLE `ScrapedTrue` (
  `key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` json NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
CREATE TABLE `Scraped` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` json NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
CREATE TABLE `HashPageCount` (
  `hash` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pageCount` int NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`hash`),
  KEY `HashPageCount_pageCount_idx` (`pageCount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
