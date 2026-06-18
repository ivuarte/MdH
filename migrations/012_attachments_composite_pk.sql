-- GLPI deduplica Documents por sha1: el mismo Document puede estar enlazado a
-- múltiples tickets via Document_Item. Antes la PK era solo document_id, lo que
-- hacía invisible el segundo (y tercer, etc) ticket que adjuntara el mismo archivo.
-- PK compuesta (document_id, ticket_id): un tracker por par (Document GLPI, ticket).

ALTER TABLE glpi_attachments
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (document_id, ticket_id);

ALTER TABLE aranda_attachment_notes
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (document_id, ticket_id);
