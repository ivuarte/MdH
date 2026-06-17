CREATE TABLE IF NOT EXISTS aranda_inbound_items (
  aranda_item_id BIGINT PRIMARY KEY,
  composed_item_id VARCHAR(128) NULL,
  glpi_ticket_id INT NULL,
  aranda_segment TINYINT NOT NULL,
  subject VARCHAR(500) NULL,
  description LONGTEXT NULL,
  aranda_state_id INT NULL,
  aranda_author_id BIGINT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  tries INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at TIMESTAMP NULL DEFAULT NULL,
  KEY idx_status (status),
  KEY idx_glpi_ticket_id (glpi_ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aranda_inbound_notes (
  aranda_note_id VARCHAR(128) PRIMARY KEY,
  aranda_item_id BIGINT NOT NULL,
  glpi_ticket_id INT NULL,
  glpi_followup_id BIGINT NULL,
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

CREATE TABLE IF NOT EXISTS sync_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  direction ENUM('GLPI_TO_ARANDA','ARANDA_TO_GLPI') NOT NULL,
  entity_type ENUM('ticket','note','solution','status') NOT NULL,
  entity_id_src VARCHAR(128) NOT NULL,
  entity_id_dst VARCHAR(128) NULL,
  content_hash CHAR(64) NULL,
  ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dir_entity (direction, entity_type, entity_id_src),
  KEY idx_hash (content_hash),
  KEY idx_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
