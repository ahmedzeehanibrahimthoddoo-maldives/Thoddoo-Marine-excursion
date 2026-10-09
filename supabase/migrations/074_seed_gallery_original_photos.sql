-- =============================================
-- Migration 074: (retired)
-- The gallery is seeded in 018_cms.sql with the centre's own photos
-- (/images/thoddoo/). The old 88-photo shoot no longer applies.
-- The gallery_items.tag column is added in 018 (and guarded here for
-- databases created before that change).
-- =============================================

alter table public.gallery_items
  add column if not exists tag text;
