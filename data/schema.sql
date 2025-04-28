-- Create chat schema
CREATE SCHEMA IF NOT EXISTS chat;

-- Messages table to store chat conversations
CREATE TABLE IF NOT EXISTS chat.messages (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(100) NOT NULL,  -- Composite of pharmacy_id and product_id
    pharmacy_id INTEGER NOT NULL,
    product_id VARCHAR(50) NOT NULL,        -- CIP13 code
    message_text TEXT NOT NULL,
    is_sent BOOLEAN NOT NULL,               -- true if sent by user, false if received
    status VARCHAR(20) DEFAULT 'sent',      -- sent, delivered, read
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pharmacy_id) REFERENCES officines.etablissements(id)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_pharmacy ON chat.messages(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_messages_product ON chat.messages(product_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON chat.messages(created_at);

-- Conversations metadata table
CREATE TABLE IF NOT EXISTS chat.conversations (
    id VARCHAR(100) PRIMARY KEY,            -- Same as conversation_id in messages
    pharmacy_id INTEGER NOT NULL,
    product_id VARCHAR(50) NOT NULL,        -- CIP13 code
    status VARCHAR(20) DEFAULT 'active',    -- active, archived, closed
    unread_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pharmacy_id) REFERENCES officines.etablissements(id)
);

-- Function to update conversation last_message_at
CREATE OR REPLACE FUNCTION chat.update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat.conversations
    SET last_message_at = NEW.created_at,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update conversation timestamp when new message is added
DROP TRIGGER IF EXISTS update_conversation_last_message ON chat.messages;
CREATE TRIGGER update_conversation_last_message
    AFTER INSERT ON chat.messages
    FOR EACH ROW
    EXECUTE FUNCTION chat.update_conversation_timestamp(); 