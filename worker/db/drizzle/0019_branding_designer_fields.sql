ALTER TABLE `project_branding` ADD COLUMN `wordmark` text;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `background_mode` text DEFAULT 'cream' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `layout` text DEFAULT 'split' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `show_social_proof` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `show_faq` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `show_earnings_calculator` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `show_terms_acceptance` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `social_proof_text` text;--> statement-breakpoint
ALTER TABLE `project_branding` ADD COLUMN `social_proof_avatars` text;
