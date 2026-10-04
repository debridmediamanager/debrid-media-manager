-- SHOW CREATE TABLE on dmmdb (MySQL 8.0.36), read 2026-10-04 in a read-only session:
-- the tables the scraped-result verdicts read and write besides the library pages
-- in scraped-tables.sql. AUTO_INCREMENT counters are left out. Statements are
-- separated by a line holding only ";".
CREATE TABLE `ScrapedVerdict` (
  `id` int NOT NULL AUTO_INCREMENT,
  `imdbId` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hash` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `titleKey` char(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `verdict` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `media` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `titleMatch` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `engine` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ScrapedVerdict_imdbId_hash_titleKey_key` (`imdbId`,`hash`,`titleKey`),
  KEY `ScrapedVerdict_imdbId_titleKey_idx` (`imdbId`,`titleKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
CREATE TABLE `ScrapedTrash` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `imdbId` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `movieTitle` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hash` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `fileSize` double DEFAULT NULL,
  `rule` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `engine` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `trashedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ScrapedTrash_imdbId_idx` (`imdbId`),
  KEY `ScrapedTrash_hash_idx` (`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
CREATE TABLE `Cache` (
  `key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` json NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
CREATE TABLE `imdb_title_basics` (
  `tconst` varchar(12) NOT NULL,
  `title_type` varchar(20) NOT NULL,
  `primary_title` varchar(500) DEFAULT NULL,
  `original_title` varchar(500) DEFAULT NULL,
  `is_adult` tinyint(1) DEFAULT '0',
  `start_year` smallint unsigned DEFAULT NULL,
  `end_year` smallint unsigned DEFAULT NULL,
  `runtime_minutes` int unsigned DEFAULT NULL,
  PRIMARY KEY (`tconst`),
  KEY `idx_title_type` (`title_type`),
  KEY `idx_start_year` (`start_year`),
  KEY `idx_is_adult` (`is_adult`),
  FULLTEXT KEY `ft_primary_title` (`primary_title`),
  FULLTEXT KEY `ft_ngram_primary_title` (`primary_title`) /*!50100 WITH PARSER `ngram` */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
