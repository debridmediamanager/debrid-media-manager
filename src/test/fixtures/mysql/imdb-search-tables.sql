-- dmmdb's IMDb search tables on 2026-10-24, MySQL 8.0.36, with idx_primary_title.
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
  KEY `idx_primary_title` (`primary_title`(100)),
  FULLTEXT KEY `ft_primary_title` (`primary_title`),
  FULLTEXT KEY `ft_ngram_primary_title` (`primary_title`) /*!50100 WITH PARSER `ngram` */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
;
CREATE TABLE `imdb_title_ratings` (
  `tconst` varchar(12) NOT NULL,
  `average_rating` decimal(3,1) NOT NULL,
  `num_votes` int unsigned NOT NULL,
  PRIMARY KEY (`tconst`),
  KEY `idx_rating` (`average_rating`),
  KEY `idx_votes` (`num_votes`),
  KEY `idx_rating_votes` (`average_rating`,`num_votes`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
;
CREATE TABLE `imdb_title_akas` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title_id` varchar(12) NOT NULL,
  `ordering` smallint unsigned NOT NULL,
  `title` text,
  `region` varchar(10) DEFAULT NULL,
  `language` varchar(10) DEFAULT NULL,
  `types` text,
  `attributes` text,
  `is_original_title` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_title_ordering` (`title_id`,`ordering`),
  FULLTEXT KEY `ft_title` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
;
