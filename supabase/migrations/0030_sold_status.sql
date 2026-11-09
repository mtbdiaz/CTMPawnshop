-- 0030 (Nov 9, 2026, Wush): #43 / UC16 "Sold" item status. Its own file because Postgres can't use a new
-- enum value in the same transaction that adds it (0031 uses it). Nothing else changes.
alter type public.inventory_status add value if not exists 'sold';
