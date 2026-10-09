-- Frozen schema from Volna 0.2, with no user data.
CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE chats(id INTEGER PRIMARY KEY, pair TEXT UNIQUE NOT NULL);
CREATE TABLE members(chat_id INTEGER REFERENCES chats(id), user_id INTEGER REFERENCES users(id), last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(chat_id,user_id));
CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES chats(id), sender_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, client_id TEXT NOT NULL, created_at TEXT NOT NULL, attachment_id TEXT, reply_to INTEGER, edited_at TEXT, deleted_at TEXT, forwarded_name TEXT, forward_source INTEGER, UNIQUE(sender_id,client_id));
CREATE TABLE attachments(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE reactions(message_id INTEGER NOT NULL REFERENCES messages(id),user_id INTEGER NOT NULL REFERENCES users(id),emoji TEXT NOT NULL,PRIMARY KEY(message_id,user_id,emoji));
CREATE TABLE pins(chat_id INTEGER NOT NULL REFERENCES chats(id),message_id INTEGER NOT NULL REFERENCES messages(id),PRIMARY KEY(chat_id,message_id));
CREATE INDEX messages_chat ON messages(chat_id,id);
CREATE INDEX members_user ON members(user_id,chat_id);
CREATE INDEX sessions_expires ON sessions(expires);
CREATE INDEX messages_attachment ON messages(attachment_id);
PRAGMA user_version=2;
