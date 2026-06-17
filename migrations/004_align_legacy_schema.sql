-- Migración correctiva: alinea las tablas heredadas del MVP con el esquema esperado por v2.
-- En instalaciones nuevas, las migraciones 001/002 crean estas tablas con el esquema correcto.
-- En instalaciones que vienen del MVP, esas migraciones usaron CREATE TABLE IF NOT EXISTS y
-- no tocaron las tablas existentes; faltan columnas como origin, created_at, etc.
-- Usa "ADD COLUMN IF NOT EXISTS" (MariaDB) y es idempotente.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI' AFTER id;

ALTER TABLE tickets ADD INDEX IF NOT EXISTS idx_origin (origin);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE tickets MODIFY COLUMN nombre VARCHAR(255) NULL;

ALTER TABLE tickets MODIFY COLUMN date_creation DATETIME NULL;

ALTER TABLE tickets MODIFY COLUMN status INT NULL;

ALTER TABLE tickets MODIFY COLUMN type INT NULL;

ALTER TABLE aranda_items ADD COLUMN IF NOT EXISTS origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI' AFTER composed_item_id;

ALTER TABLE aranda_items ADD INDEX IF NOT EXISTS idx_origin (origin);

ALTER TABLE ticket_followups ADD COLUMN IF NOT EXISTS origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI';

ALTER TABLE ticket_followups ADD INDEX IF NOT EXISTS idx_origin (origin);

ALTER TABLE ticket_followups ADD COLUMN IF NOT EXISTS external_id VARCHAR(128) NULL;

ALTER TABLE ticket_followups ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE ticket_solutions ADD COLUMN IF NOT EXISTS origin ENUM('GLPI','ARANDA') NOT NULL DEFAULT 'GLPI';

ALTER TABLE ticket_solutions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
