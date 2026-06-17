-- 008 — Sincronización de adjuntos GLPI ↔ Aranda.
-- ATENCIÓN: Aranda no expone POST de adjuntos vía API con el rol Atena_GLPI.
-- Por eso GLPI→Aranda usa WORKAROUND: nota anunciando el adjunto (no el binario).
-- Aranda→GLPI sí es completo: descarga del Url firmado de Aranda y POST /Document a GLPI.

-- Tracker de documentos descubiertos en tickets GLPI.
CREATE TABLE IF NOT EXISTS glpi_attachments (
  document_id  INT UNSIGNED PRIMARY KEY,
  ticket_id    INT UNSIGNED NOT NULL,
  name         VARCHAR(255) NOT NULL,
  size         BIGINT NULL,
  mime         VARCHAR(128) NULL,
  detected_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tracker workaround GLPI → Aranda: nota anunciando el adjunto.
CREATE TABLE IF NOT EXISTS aranda_attachment_notes (
  document_id     INT UNSIGNED PRIMARY KEY,
  ticket_id       INT UNSIGNED NOT NULL,
  aranda_item_id  BIGINT NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  tries           INT NOT NULL DEFAULT 0,
  last_error      TEXT NULL,
  posted_at       DATETIME NULL,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tracker Aranda → GLPI: descarga real + upload a GLPI.
CREATE TABLE IF NOT EXISTS aranda_inbound_files (
  aranda_file_id  INT UNSIGNED PRIMARY KEY,
  aranda_item_id  BIGINT NOT NULL,
  aranda_segment  TINYINT NOT NULL,
  glpi_ticket_id  INT UNSIGNED NULL,
  glpi_document_id INT UNSIGNED NULL,
  name            VARCHAR(255) NOT NULL,
  size            BIGINT NULL,
  url             TEXT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  tries           INT NOT NULL DEFAULT 0,
  last_error      TEXT NULL,
  detected_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at       DATETIME NULL,
  INDEX idx_item (aranda_item_id, aranda_segment),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Extender sync_events con tipo attachment.
ALTER TABLE sync_events MODIFY COLUMN entity_type
  ENUM('ticket','note','solution','status','task','priority','urgency','attachment') NOT NULL;
