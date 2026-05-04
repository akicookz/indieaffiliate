ALTER TABLE `partners` ADD COLUMN `commission_program_id` text REFERENCES `commission_programs`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `partners` ADD COLUMN `channel` text;--> statement-breakpoint
ALTER TABLE `commissions` ADD COLUMN `commission_program_id` text REFERENCES `commission_programs`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `commissions` ADD COLUMN `month_index` integer;--> statement-breakpoint
ALTER TABLE `commissions` ADD COLUMN `mrr` real;
