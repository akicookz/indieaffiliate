CREATE TABLE IF NOT EXISTS `partner_otps` (
	`email` text NOT NULL,
	`otp_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_partner_otps_email` ON `partner_otps` (`email`);
