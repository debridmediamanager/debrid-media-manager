-- When DMM first recorded a Real-Debrid cache row, for the Torznab feed's RSS
-- sync. Added nullable first and given its default second, so the rows that
-- existed before stay NULL rather than all taking the time of the change.
-- AvailableAd already has the column. Additive only. Apply before deploying the
-- code that reads it.
ALTER TABLE `Available` ADD COLUMN `createdAt` DATETIME(3) NULL, ALGORITHM=INSTANT;
ALTER TABLE `Available` MODIFY COLUMN `createdAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3), ALGORITHM=INSTANT;
ALTER TABLE `Available` ADD INDEX `Available_createdAt_idx` (`createdAt`), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE `AvailableAd` ADD INDEX `AvailableAd_createdAt_idx` (`createdAt`), ALGORITHM=INPLACE, LOCK=NONE;
