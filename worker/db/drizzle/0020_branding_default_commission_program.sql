ALTER TABLE `project_branding` ADD COLUMN `default_commission_program_id` text REFERENCES `commission_programs`(`id`) ON DELETE SET NULL;
