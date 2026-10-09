-- =============================================
-- Migration 071: Wind Surf Lesson missing image
-- The public landing page renders activity cards from activities.image;
-- wind-surf-lesson had a NULL image -> broken card. Assign a real
-- Thoddoo shoot photo as a placeholder until the cameraman's photo set
-- is delivered (then swap via admin content editor).
-- =============================================

BEGIN;

UPDATE public.activities
SET image = '/images/thoddoo/fun-ride.jpg'
WHERE slug = 'wind-surf-lesson'
  AND (image IS NULL OR image = '');

COMMIT;