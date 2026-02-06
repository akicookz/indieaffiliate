-- Add configurable metadata field mappings to stripe connections
ALTER TABLE stripe_connections ADD COLUMN metadata_mappings TEXT DEFAULT NULL;
