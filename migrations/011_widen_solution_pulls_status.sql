-- Ampliar status para 'synced_as_followup' (18 chars). VARCHAR(16) original era angosto.
ALTER TABLE aranda_solution_pulls MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending';
