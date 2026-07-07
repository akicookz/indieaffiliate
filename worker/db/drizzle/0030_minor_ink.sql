CREATE TABLE `commission_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`commission_id` text NOT NULL,
	`amount` real NOT NULL,
	`reason` text DEFAULT 'refund' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applied_payout_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`applied_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`commission_id`) REFERENCES `commissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commission_adjustments_commission` ON `commission_adjustments` (`commission_id`);--> statement-breakpoint
CREATE INDEX `idx_commission_adjustments_partner_status` ON `commission_adjustments` (`partner_id`,`status`);