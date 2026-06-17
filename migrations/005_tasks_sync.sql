-- Migración 005: soporte para sincronización de TAREAS (ITILTask / TicketTask en GLPI ↔ Aranda)
--
-- En GLPI las tareas son una entidad separada (TicketTask) con id propio, distinta de ITILFollowup.
-- En Aranda, no existe una API CRUD separada para tareas — se gestionan como entries en el historial
-- (/item/{id}/{seg}/note/list con ActionType=22 "AGREGAR TAREA"). Para propagar una tarea GLPI a Aranda
-- se inserta como NOTA con prefijo `[Tarea GLPI]` (texto), funcionalmente equivalente para el operador.
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS y ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS ticket_tasks (
  task_id BIGINT PRIMARY KEY,
  ticket_id INT NOT NULL,
  user_name VARCHAR(255) NULL,
  content TEXT NULL,
  date DATETIME NULL,
  state INT NULL,
  origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI',
  external_id VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ticket_id (ticket_id),
  KEY idx_origin (origin),
  KEY idx_external_id (external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabla de propagación GLPI → Aranda (espejo de aranda_followup_notes pero para tareas).
CREATE TABLE IF NOT EXISTS aranda_task_notes (
  task_id BIGINT PRIMARY KEY,
  ticket_id INT NOT NULL,
  aranda_item_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  tries INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  posted_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ticket_id (ticket_id),
  KEY idx_aranda_item_id (aranda_item_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Inbound de tareas Aranda → GLPI (entries ActionType=22 detectados en note/list).
-- Aranda no expone un id estable para estos entries (Id=0 siempre), así que usamos un hash compuesto.
CREATE TABLE IF NOT EXISTS aranda_inbound_tasks (
  aranda_task_id VARCHAR(128) PRIMARY KEY,
  aranda_item_id BIGINT NOT NULL,
  glpi_ticket_id INT NULL,
  glpi_task_id BIGINT NULL,
  description TEXT NULL,
  author VARCHAR(255) NULL,
  author_id BIGINT NULL,
  posted_in_aranda_at DATETIME NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  tries INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at TIMESTAMP NULL DEFAULT NULL,
  KEY idx_aranda_item_id (aranda_item_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Asegurar que sync_events soporta entity_type='task' (ENUM existente: ticket/note/solution/status).
ALTER TABLE sync_events
  MODIFY COLUMN entity_type ENUM('ticket','note','solution','status','task') NOT NULL;
