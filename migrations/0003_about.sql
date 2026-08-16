-- Personal context about the player, written by the admin; injected into every
-- composed message so the bot "knows her".
ALTER TABLE users ADD COLUMN about TEXT;
