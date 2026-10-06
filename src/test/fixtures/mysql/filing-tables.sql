-- SHOW CREATE TABLE on dmmdb (MySQL 8.0.36), read 2026-10-06 in a read-only session:
-- what filing a finished transfer writes besides its library page (scraped-tables.sql),
-- and the IMDb title types it reads to find that page. Both names `Available`
-- keeps are varchar(191), counted in characters. Statements are separated by a
-- line holding only ";".
CREATE TABLE `Available` (
  `hash` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `imdbId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `filename` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `originalFilename` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bytes` bigint NOT NULL,
  `originalBytes` bigint NOT NULL,
  `host` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `progress` int NOT NULL,
  `status` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ended` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `season` int DEFAULT NULL,
  `episode` int DEFAULT NULL,
  PRIMARY KEY (`hash`),
  KEY `Available_status_idx` (`status`),
  KEY `Available_imdbId_idx` (`imdbId`),
  KEY `Available_imdbId_hash_idx` (`imdbId`,`hash`),
  KEY `Available_imdbId_status_season_episode_bytes_idx` (`imdbId`,`status`,`season`,`episode`,`bytes`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
CREATE TABLE `AvailableFile` (
  `link` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_id` int NOT NULL,
  `hash` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `path` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bytes` bigint NOT NULL,
  `season` int DEFAULT NULL,
  `episode` int DEFAULT NULL,
  PRIMARY KEY (`link`),
  KEY `AvailableFile_hash_idx` (`hash`),
  KEY `AvailableFile_hash_season_episode_idx` (`hash`,`season`,`episode`)
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
