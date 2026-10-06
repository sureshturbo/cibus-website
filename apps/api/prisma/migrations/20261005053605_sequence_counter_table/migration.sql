/*
  Warnings:

  - You are about to drop the `invoice_sequences` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE `invoice_sequences`;

-- CreateTable
CREATE TABLE `sequence_counters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scope` VARCHAR(16) NOT NULL,
    `period` VARCHAR(16) NOT NULL,
    `last_value` INTEGER NOT NULL DEFAULT 0,
    `prefix` VARCHAR(8) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sequence_counters_scope_period_key`(`scope`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
