-- Whether content-identifier named a movie or a show. Additive only.
ALTER TABLE `HashIdentification` ADD COLUMN `kind` VARCHAR(8) NULL;
