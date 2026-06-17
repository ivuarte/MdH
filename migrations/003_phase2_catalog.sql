CREATE TABLE IF NOT EXISTS service_catalog_sync (
  id INT AUTO_INCREMENT PRIMARY KEY,
  glpi_category_id INT NULL,
  glpi_category_name VARCHAR(500) NULL,
  glpi_category_path VARCHAR(1000) NULL,
  aranda_category_id INT NULL,
  aranda_category_name VARCHAR(500) NULL,
  aranda_service_id INT NULL,
  aranda_service_name VARCHAR(500) NULL,
  match_strategy VARCHAR(32) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_glpi (glpi_category_id),
  UNIQUE KEY uniq_aranda (aranda_category_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
