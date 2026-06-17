-- Tracker de soluciones pull-back Aranda → GLPI.
-- Una fila por aranda_item_id (una solución por caso). Permite reintentos
-- (status='failed', tries < N) y evita duplicados.
CREATE TABLE IF NOT EXISTS aranda_solution_pulls (
  aranda_item_id BIGINT PRIMARY KEY,
  ticket_id INT NOT NULL,
  glpi_solution_id INT NULL,
  source_creation_date VARCHAR(64) NULL,
  source_author VARCHAR(255) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  tries INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  posted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ticket_id (ticket_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
