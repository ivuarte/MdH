-- 009 — Asignación de Grupo Resolutor + Usuario Responsable por subcategoría Aranda.
--
-- Cada subcategoría tiene un "Responsable de Gestión Grupo" (texto, p.ej. "Ministerio de Hacienda - DTIC").
-- Ese label resuelve a:
--   - aranda_group_id      → GroupId que se envía al crear el caso en Aranda.
--   - aranda_default_user_id → ResponsibleId que se envía al crear el caso.

-- 1) Catálogo local de grupos Aranda + usuario default.
CREATE TABLE IF NOT EXISTS aranda_groups (
  id                  INT UNSIGNED PRIMARY KEY,        -- código del grupo en Aranda
  name                VARCHAR(255) NOT NULL,           -- nombre interno del grupo Aranda
  responsable_label   VARCHAR(128) NOT NULL,           -- etiqueta usada en el catálogo
  default_user_id     INT UNSIGNED NULL,               -- ResponsibleId por defecto
  default_user_name   VARCHAR(255) NULL,
  is_default_for_label TINYINT(1) NOT NULL DEFAULT 0,  -- si el label tiene varios grupos, este es el preferido
  notes               VARCHAR(500) NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_label     (responsable_label, is_default_for_label),
  INDEX idx_user      (default_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Extender el catálogo con la etiqueta de responsable.
ALTER TABLE service_catalog_sync
  ADD COLUMN IF NOT EXISTS responsable_label VARCHAR(128) NULL AFTER aranda_category_name,
  ADD INDEX IF NOT EXISTS idx_responsable (responsable_label);
