-- SHOW CREATE TABLE on dmmdb (MySQL 8.0.36), read 2026-10-04 in a read-only session.
-- The server runs InnoDB at REPEATABLE-READ with innodb_lock_wait_timeout 50 and
-- deadlock detection on. Statements are separated by a line holding only ";".
CREATE TABLE `TorrentSnapshot` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hash` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `addedDate` datetime(3) NOT NULL,
  `payload` json NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `TorrentSnapshot_hash_idx` (`hash`),
  KEY `TorrentSnapshot_hash_addedDate_idx` (`hash`,`addedDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
