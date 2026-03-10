DROP TABLE IF EXISTS `partner_otps`;
--> statement-breakpoint
CREATE TABLE `partner_otps` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `email` text NOT NULL,
  `code_hash` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_partner_otps_project_email` ON `partner_otps` (`project_id`,`email`);

