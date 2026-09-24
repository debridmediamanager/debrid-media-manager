-- A request now carries what a direct transfer submission already sends:
-- the release size, for the size cap and host routing, and the page it was
-- asked from, so the completed transfer is filed under the right title.
-- Both are nullable; requests filed before this have neither.
ALTER TABLE `ContentRequest` ADD COLUMN `sizeBytes` BIGINT NULL, ADD COLUMN `returnPath` TEXT NULL;
