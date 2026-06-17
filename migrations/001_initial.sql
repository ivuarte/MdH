CREATE TABLE IF NOT EXISTS tickets (
  id INT PRIMARY KEY,
  origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI',
  nombre VARCHAR(255),
  date_creation DATETIME NULL,
  closedate DATETIME NULL,
  solvedate DATETIME NULL,
  status INT NULL,
  type INT NULL,
  users_id_recipient VARCHAR(255) NULL,
  content LONGTEXT NULL,
  itilcategory_name VARCHAR(255) NULL,
  ITILFollowup LONGTEXT NULL,
  ITILSolution LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_origin (origin),
  KEY idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_followups (
  followup_id BIGINT PRIMARY KEY,
  ticket_id INT NOT NULL,
  user_name VARCHAR(255) NULL,
  content TEXT NULL,
  date DATETIME NULL,
  origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI',
  external_id VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ticket_id (ticket_id),
  KEY idx_origin (origin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_solutions (
  solution_id BIGINT PRIMARY KEY,
  ticket_id INT NOT NULL,
  user_name VARCHAR(255) NULL,
  content TEXT NULL,
  date_creation DATETIME NULL,
  origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ticket_id (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aranda_items (
  ticket_id INT PRIMARY KEY,
  aranda_item_id BIGINT NULL,
  composed_item_id VARCHAR(128) NULL,
  origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI',
  status VARCHAR(32) NOT NULL DEFAULT 'synced',
  last_error TEXT NULL,
  glpi_backlinked_at TIMESTAMP NULL DEFAULT NULL,
  glpi_backlink_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_aranda_item_id (aranda_item_id),
  KEY idx_composed_item_id (composed_item_id),
  KEY idx_origin (origin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aranda_followup_notes (
  followup_id BIGINT PRIMARY KEY,
  ticket_id INT NOT NULL,
  aranda_item_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'synced',
  tries INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  posted_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ticket_id (ticket_id),
  KEY idx_aranda_item_id (aranda_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aranda_solution_updates (
  solution_id BIGINT PRIMARY KEY,
  ticket_id INT NOT NULL,
  aranda_item_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'synced',
  tries INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  posted_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ticket_id (ticket_id),
  KEY idx_aranda_item_id (aranda_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aranda_status_sync (
  ticket_id INT PRIMARY KEY,
  aranda_item_id BIGINT NOT NULL,
  last_glpi_status INT NULL,
  last_aranda_stateid INT NULL,
  last_push_at TIMESTAMP NULL DEFAULT NULL,
  last_pull_at TIMESTAMP NULL DEFAULT NULL,
  last_error TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_aranda_item_id (aranda_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sync_cursors (
  cursor_name VARCHAR(128) PRIMARY KEY,
  cursor_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
