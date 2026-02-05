CREATE TABLE `project_branding` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`logo` text,
	`brand_color` text DEFAULT '#7c3aed' NOT NULL,
	`headline` text DEFAULT 'Join our affiliate program' NOT NULL,
	`description` text,
	`background_image` text,
	`cta_text` text DEFAULT 'Become a Partner' NOT NULL,
	`auto_approve` integer DEFAULT false NOT NULL,
	`default_commission_rate` real DEFAULT 0.2 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_branding_project_id_unique` ON `project_branding` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_branding_project` ON `project_branding` (`project_id`);