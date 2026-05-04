CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`partner_id` text,
	`source` text DEFAULT 'stripe' NOT NULL,
	`external_payment_id` text NOT NULL,
	`kind` text NOT NULL,
	`customer_email` text,
	`customer_name` text,
	`plan_name` text,
	`mrr` real,
	`started_at` integer,
	`status` text,
	`flag_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payments_project_source_extid` ON `payments` (`project_id`,`source`,`external_payment_id`);
--> statement-breakpoint
CREATE INDEX `idx_payments_project_partner` ON `payments` (`project_id`,`partner_id`);
--> statement-breakpoint
CREATE INDEX `idx_payments_project` ON `payments` (`project_id`);
