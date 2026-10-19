-- rex-direct open to any claimed rex: per-server certificates and the Plex account
-- that owns each name. Additive only (shortId just becomes nullable).
ALTER TABLE `RexDirectName`
    MODIFY `shortId` VARCHAR(16) NULL,
    ADD COLUMN `plexAccountId` VARCHAR(32) NULL,
    ADD COLUMN `certificate` MEDIUMTEXT NULL,
    ADD COLUMN `privateKey` TEXT NULL,
    ADD COLUMN `certExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `issuingSince` DATETIME(3) NULL,
    ADD INDEX `RexDirectName_plexAccountId_idx`(`plexAccountId`);
