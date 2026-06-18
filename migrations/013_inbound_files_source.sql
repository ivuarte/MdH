-- Distinguir el origen del row en aranda_inbound_files:
--   'pull' (default): Aranda → GLPI — el bot descargó binario de Aranda y creó el Document en GLPI.
--                     glpi_attachments debe skipearlo para que NO se reanuncie a Aranda.
--   'push'          : GLPI → Aranda — el bot subió un Document existente de GLPI a Aranda y
--                     registra el aranda_file_id resultante SOLO para anti-eco del pull.
--                     glpi_attachments NO debe filtrar por este registro (el doc lo subió un
--                     humano a GLPI, no el bot).
ALTER TABLE aranda_inbound_files
  ADD COLUMN source ENUM('pull','push') NOT NULL DEFAULT 'pull';

-- Backfill explícito de rows existentes: las que tienen glpi_document_id Y aranda_file_id válidos
-- y que coincidan con un aranda_attachment_notes synced son del PUSH (subimos GLPI→Aranda).
-- El resto se queda como 'pull' (el default).
UPDATE aranda_inbound_files aif
   JOIN aranda_attachment_notes aan
     ON aan.document_id = aif.glpi_document_id
    AND aan.ticket_id   = aif.glpi_ticket_id
    AND aan.status      = 'synced'
   SET aif.source = 'push';
