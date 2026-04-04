-- Add seated_count column to track how many guests are currently at a table
ALTER TABLE "tables" ADD COLUMN seated_count int NOT NULL DEFAULT 0;
