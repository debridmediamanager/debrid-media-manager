-- Wikidata's external ids for films, TV and anime, rebuilt weekly by
-- scripts/import-wikidata.ts. Additive only. `value` is binary-collated with
-- NO PAD so ids differing in case or a trailing space stay distinct.
CREATE TABLE `wikidata_external_ids` (
    `qid` INTEGER UNSIGNED NOT NULL,
    `prop` VARCHAR(12) NOT NULL,
    `value` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,

    INDEX `wikidata_external_ids_qid_idx`(`qid`),
    PRIMARY KEY (`prop`, `value`, `qid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wikidata_properties` (
    `prop` VARCHAR(12) NOT NULL,
    `label` VARCHAR(255) NULL,
    `formatter_url` VARCHAR(512) NULL,
    `items` INTEGER UNSIGNED NOT NULL,
    `row_count` INTEGER UNSIGNED NOT NULL,

    PRIMARY KEY (`prop`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
