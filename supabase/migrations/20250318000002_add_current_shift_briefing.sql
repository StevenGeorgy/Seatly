-- Add current_shift_briefing column to restaurants for nightly AI-generated shift briefings
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS current_shift_briefing text;
