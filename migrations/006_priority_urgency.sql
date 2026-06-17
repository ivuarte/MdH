-- Migración 006: sincronización de urgencia y prioridad GLPI ↔ Aranda.
--
-- GLPI maneja 3 campos en cada ticket: urgency, impact, priority (todos enum 1..5).
-- Aranda expone /urgency/list y /priority/list (Id+Value) y NO expone /impact/list (404 —
-- el impacto suele calcularlo Aranda como derivado de urgency*priority, no es editable
-- vía API con los permisos del bot).
--
-- Por eso este sistema sincroniza urgency y priority en ambas direcciones; el impact GLPI
-- se persiste localmente pero no se propaga a Aranda.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS urgency  INT NULL AFTER status;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS impact   INT NULL AFTER urgency;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority INT NULL AFTER impact;

ALTER TABLE aranda_inbound_items ADD COLUMN IF NOT EXISTS aranda_urgency_id  INT NULL;
ALTER TABLE aranda_inbound_items ADD COLUMN IF NOT EXISTS aranda_priority_id INT NULL;

-- Cache de sincronización de prioridad/urgencia (espejo de aranda_status_sync).
-- Anti-eco: si propagamos GLPI→Aranda hace <ANTI_ECHO_WINDOW_SECONDS no aplicamos el eco B→A.
CREATE TABLE IF NOT EXISTS aranda_priority_sync (
  ticket_id            INT PRIMARY KEY,
  aranda_item_id       BIGINT NOT NULL,
  last_glpi_urgency    INT NULL,
  last_glpi_priority   INT NULL,
  last_aranda_urgency  INT NULL,
  last_aranda_priority INT NULL,
  last_push_at         TIMESTAMP NULL DEFAULT NULL,
  last_pull_at         TIMESTAMP NULL DEFAULT NULL,
  last_error           TEXT NULL,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_aranda_item_id (aranda_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Extender entity_type de sync_events con 'priority' y 'urgency' (para anti-eco granular).
ALTER TABLE sync_events
  MODIFY COLUMN entity_type ENUM('ticket','note','solution','status','task','priority','urgency') NOT NULL;
