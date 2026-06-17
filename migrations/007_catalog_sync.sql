-- 007 — Sincronización del catálogo de categorías GLPI ↔ Aranda.
-- Idempotente (ADD COLUMN IF NOT EXISTS / ADD INDEX IF NOT EXISTS — MariaDB).

-- 1) tickets: guardar la categoría GLPI como número (no solo el nombre).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS itilcategories_id INT UNSIGNED NULL AFTER itilcategory_name;
ALTER TABLE tickets ADD INDEX IF NOT EXISTS idx_itilcat (itilcategories_id);

-- 2) service_catalog_sync: la subcategoría Aranda vive en un segmento (1=IM, 4=RF).
--    Necesario para enviar al endpoint correcto /item/add/{segment}.
ALTER TABLE service_catalog_sync ADD COLUMN IF NOT EXISTS aranda_segment TINYINT UNSIGNED NULL AFTER aranda_category_id;
ALTER TABLE service_catalog_sync ADD INDEX IF NOT EXISTS idx_aranda_seg (aranda_category_id, aranda_segment);

-- 3) aranda_inbound_items: capturar la categoría con la que llegó el caso desde Aranda.
ALTER TABLE aranda_inbound_items ADD COLUMN IF NOT EXISTS aranda_category_id INT NULL;
ALTER TABLE aranda_inbound_items ADD INDEX IF NOT EXISTS idx_aranda_cat (aranda_category_id);
