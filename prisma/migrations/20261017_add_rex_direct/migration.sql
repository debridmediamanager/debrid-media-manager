-- rex-direct: per-server hostnames and the shared wildcard cert. Additive only.
CREATE TABLE `RexDirectName` (
    `machineIdentifier` VARCHAR(64) NOT NULL,
    `hash` VARCHAR(64) NOT NULL,
    `shortId` VARCHAR(16) NOT NULL,
    `lastIp` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`machineIdentifier`),
    UNIQUE INDEX `RexDirectName_hash_key`(`hash`),
    INDEX `RexDirectName_shortId_idx`(`shortId`)
);

CREATE TABLE `RexDirectCert` (
    `id` VARCHAR(16) NOT NULL,
    `fullchain` MEDIUMTEXT NOT NULL,
    `privkey` MEDIUMTEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
);
