CREATE TABLE `payout_commissions` (
	`payout_id` text NOT NULL,
	`commission_id` text NOT NULL,
	`amount` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`payout_id`) REFERENCES `payouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`commission_id`) REFERENCES `commissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payout_commissions_payout_commission` ON `payout_commissions` (`payout_id`,`commission_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payout_commissions_commission_unique` ON `payout_commissions` (`commission_id`);
--> statement-breakpoint
CREATE INDEX `idx_payout_commissions_payout` ON `payout_commissions` (`payout_id`);
