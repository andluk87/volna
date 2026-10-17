CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, last_seen INTEGER, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', profile_setup_required INTEGER NOT NULL DEFAULT 0, admin_blocked INTEGER NOT NULL DEFAULT 0, admin_reason TEXT NOT NULL DEFAULT '', phone_verified_at INTEGER NOT NULL DEFAULT 0, bio TEXT NOT NULL DEFAULT '', avatar_id TEXT, avatar_hidden INTEGER NOT NULL DEFAULT 0 CHECK(avatar_hidden IN (0,1)), username_normalized TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE chats(id INTEGER PRIMARY KEY, pair TEXT UNIQUE NOT NULL, admin_locked INTEGER NOT NULL DEFAULT 0, admin_deleted INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'direct', title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_by INTEGER, posting_policy TEXT NOT NULL DEFAULT 'all', parent_id INTEGER REFERENCES chats(id), topic_icon TEXT NOT NULL DEFAULT '', topic_closed INTEGER NOT NULL DEFAULT 0, topic_deleted INTEGER NOT NULL DEFAULT 0, topic_create_policy TEXT NOT NULL DEFAULT 'admins', topics_enabled INTEGER NOT NULL DEFAULT 0, general_name TEXT NOT NULL DEFAULT 'Общие вопросы', general_hidden INTEGER NOT NULL DEFAULT 0, topic_pinned INTEGER NOT NULL DEFAULT 0, topic_pin_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE members(chat_id INTEGER REFERENCES chats(id), user_id INTEGER REFERENCES users(id), last_read INTEGER NOT NULL DEFAULT 0, last_delivered INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY(chat_id,user_id));
CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES chats(id), sender_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, client_id TEXT NOT NULL, created_at TEXT NOT NULL, interactive TEXT, expression_id TEXT, album_id TEXT, attachment_id TEXT, reply_to INTEGER, edited_at TEXT, deleted_at TEXT, forwarded_name TEXT, forward_source INTEGER, transcript TEXT, UNIQUE(sender_id,client_id));
CREATE INDEX messages_chat ON messages(chat_id,id);
CREATE INDEX members_user ON members(user_id,chat_id);
CREATE INDEX sessions_expires ON sessions(expires);
CREATE TABLE admin_config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
CREATE TABLE admin_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE admin_sms(id TEXT PRIMARY KEY,phone TEXT NOT NULL,code_hash TEXT NOT NULL,reference TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,ip TEXT NOT NULL,provider_id TEXT, provider TEXT NOT NULL DEFAULT 'notificore');
CREATE INDEX admin_sms_created ON admin_sms(created);
CREATE TABLE admin_sessions(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,last_seen INTEGER NOT NULL,agent TEXT NOT NULL,ip TEXT NOT NULL);
CREATE TABLE admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,details TEXT NOT NULL);
CREATE TABLE admin_backups(id TEXT PRIMARY KEY,filename TEXT NOT NULL,created INTEGER NOT NULL,size INTEGER NOT NULL);
CREATE TABLE auth_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE sms_challenges(id TEXT PRIMARY KEY,phone TEXT NOT NULL,code_hash TEXT NOT NULL,
      reference TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,used INTEGER,attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,ip TEXT NOT NULL,provider_id TEXT, provider TEXT NOT NULL DEFAULT 'notificore', android INTEGER NOT NULL DEFAULT 0, app_hash TEXT NOT NULL DEFAULT '', request_id TEXT, purpose TEXT NOT NULL DEFAULT 'login', owner INTEGER);
CREATE INDEX sms_phone_created ON sms_challenges(phone,created);
CREATE INDEX sms_ip_created ON sms_challenges(ip,created);
CREATE TABLE auth_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,created INTEGER NOT NULL,ip TEXT NOT NULL,user_id INTEGER);
CREATE TABLE refresh_sessions(id TEXT PRIMARY KEY,refresh_hash TEXT UNIQUE NOT NULL,
      access_id TEXT UNIQUE NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),
      platform TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE qr_challenges(id TEXT PRIMARY KEY,scan_hash TEXT UNIQUE NOT NULL,poll_hash TEXT NOT NULL,
      platform TEXT NOT NULL,agent TEXT NOT NULL,ip TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',user_id INTEGER REFERENCES users(id),approved_by TEXT);
CREATE UNIQUE INDEX sms_idempotency ON sms_challenges(phone,request_id);
CREATE TABLE account_appearance(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, settings TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,platform));
CREATE TABLE account_folders(owner INTEGER PRIMARY KEY REFERENCES users(id),version INTEGER NOT NULL,folders TEXT NOT NULL);
CREATE TABLE folder_invites(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,owner INTEGER NOT NULL REFERENCES users(id),folder_id TEXT NOT NULL,snapshot TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX users_username_normalized ON users(username_normalized);
CREATE TRIGGER user_profile_timestamp AFTER UPDATE OF name,bio,avatar_id,avatar_hidden ON users BEGIN UPDATE users SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
CREATE TRIGGER username_insert AFTER INSERT ON users BEGIN UPDATE users SET username_normalized=lower(NEW.username),created_at=COALESCE(NEW.created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=COALESCE(NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=NEW.id; END;
CREATE TRIGGER username_update AFTER UPDATE OF username ON users BEGIN UPDATE users SET username_normalized=lower(NEW.username),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
CREATE TABLE chat_visibility(user_id INTEGER NOT NULL REFERENCES users(id),chat_id INTEGER NOT NULL REFERENCES chats(id),hidden_before INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,chat_id));
CREATE TABLE attachments(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL, admin_blocked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE reactions(message_id INTEGER NOT NULL REFERENCES messages(id),user_id INTEGER NOT NULL REFERENCES users(id),emoji TEXT NOT NULL,PRIMARY KEY(message_id,user_id,emoji));
CREATE TABLE pins(chat_id INTEGER NOT NULL REFERENCES chats(id),message_id INTEGER NOT NULL REFERENCES messages(id),PRIMARY KEY(chat_id,message_id));
CREATE INDEX messages_album ON messages(album_id);
CREATE INDEX messages_attachment ON messages(attachment_id);
CREATE TABLE expression_packs(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,kind TEXT NOT NULL,public INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL, builtin INTEGER NOT NULL DEFAULT 0, client_id TEXT, fingerprint TEXT, description TEXT NOT NULL DEFAULT '', slug TEXT, status TEXT NOT NULL DEFAULT 'published', updated INTEGER NOT NULL DEFAULT 0);
CREATE TABLE expression_items(id TEXT PRIMARY KEY,pack_id TEXT NOT NULL REFERENCES expression_packs(id) ON DELETE CASCADE,attachment_id TEXT NOT NULL REFERENCES attachments(id),label TEXT NOT NULL,keywords TEXT NOT NULL,fallback TEXT NOT NULL,position INTEGER NOT NULL);
CREATE TABLE expression_installs(user_id INTEGER NOT NULL REFERENCES users(id),pack_id TEXT NOT NULL REFERENCES expression_packs(id) ON DELETE CASCADE,PRIMARY KEY(user_id,pack_id));
CREATE TABLE expression_usage(user_id INTEGER NOT NULL REFERENCES users(id),item_id TEXT NOT NULL REFERENCES expression_items(id) ON DELETE CASCADE,used INTEGER NOT NULL DEFAULT 0,count INTEGER NOT NULL DEFAULT 0,favorite INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,item_id));
CREATE INDEX expression_files ON expression_items(attachment_id);
CREATE INDEX expression_pack_items ON expression_items(pack_id,position);
CREATE UNIQUE INDEX expression_pack_nonce ON expression_packs(owner_id,client_id) WHERE client_id IS NOT NULL;
CREATE TABLE expression_seeded(user_id INTEGER PRIMARY KEY REFERENCES users(id));
CREATE TABLE message_emoji(message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,item_id TEXT NOT NULL,start INTEGER NOT NULL,length INTEGER NOT NULL,attachment_id TEXT NOT NULL REFERENCES attachments(id),PRIMARY KEY(message_id,start));
CREATE INDEX message_emoji_files ON message_emoji(attachment_id);
CREATE TABLE emoji_asset_metadata(item_id TEXT PRIMARY KEY REFERENCES expression_items(id),sha256 TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,format TEXT NOT NULL,size_bytes INTEGER NOT NULL);
CREATE TABLE emoji_reports(id INTEGER PRIMARY KEY,reporter_id INTEGER NOT NULL REFERENCES users(id),pack_id TEXT NOT NULL REFERENCES expression_packs(id),reason TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE emoji_seeded(user_id INTEGER PRIMARY KEY REFERENCES users(id));
CREATE TABLE emoji_audit(id INTEGER PRIMARY KEY,actor_id INTEGER NOT NULL REFERENCES users(id),pack_id TEXT NOT NULL,action TEXT NOT NULL,created INTEGER NOT NULL);
CREATE UNIQUE INDEX one_community_owner ON members(chat_id) WHERE role='owner';
CREATE TABLE community_invites(chat_id INTEGER PRIMARY KEY REFERENCES chats(id),token_hash TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,uses INTEGER NOT NULL DEFAULT 0,max_uses INTEGER NOT NULL DEFAULT 100);
CREATE TABLE community_bans(chat_id INTEGER NOT NULL REFERENCES chats(id),user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(chat_id,user_id));
CREATE TABLE chat_preferences(user_id INTEGER NOT NULL REFERENCES users(id),chat_id INTEGER NOT NULL REFERENCES chats(id),archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)), manual_unread INTEGER NOT NULL DEFAULT 0, notification_mode TEXT NOT NULL DEFAULT 'all', notification_override INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,chat_id));
CREATE TRIGGER topic_member_add AFTER INSERT ON members BEGIN
 INSERT OR IGNORE INTO members(chat_id,user_id,role) SELECT id,NEW.user_id,NEW.role FROM chats WHERE parent_id=NEW.chat_id AND topic_deleted=0; END;
CREATE TRIGGER topic_member_remove AFTER DELETE ON members BEGIN
 DELETE FROM members WHERE user_id=OLD.user_id AND chat_id IN (SELECT id FROM chats WHERE parent_id=OLD.chat_id); END;
CREATE TRIGGER topic_member_role AFTER UPDATE OF role ON members BEGIN
 UPDATE members SET role=NEW.role WHERE user_id=NEW.user_id AND chat_id IN (SELECT id FROM chats WHERE parent_id=NEW.chat_id AND topic_deleted=0); END;
CREATE TRIGGER topic_posting_policy AFTER UPDATE OF posting_policy ON chats BEGIN
 UPDATE chats SET posting_policy=NEW.posting_policy WHERE parent_id=NEW.id; END;
CREATE TABLE push_keys(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key TEXT NOT NULL);
CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,subscription TEXT NOT NULL,preview INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE TABLE push_jobs(id INTEGER PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,topic TEXT NOT NULL,chat_id INTEGER NOT NULL,kind TEXT NOT NULL,message_id INTEGER,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,UNIQUE(subscription_id,topic));
CREATE INDEX push_jobs_due ON push_jobs(next_at);
CREATE TABLE call_history(id TEXT PRIMARY KEY,chat_id INTEGER NOT NULL REFERENCES chats(id),
  caller INTEGER NOT NULL REFERENCES users(id),callee INTEGER NOT NULL REFERENCES users(id),created INTEGER NOT NULL,
  answered INTEGER,ended INTEGER,status TEXT NOT NULL,screen_shared INTEGER NOT NULL DEFAULT 0,ringed INTEGER NOT NULL DEFAULT 0, video INTEGER NOT NULL DEFAULT 0);
CREATE INDEX call_history_caller ON call_history(caller,created);
CREATE INDEX call_history_callee ON call_history(callee,created);
CREATE TABLE call_history_hidden(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,call_id TEXT NOT NULL REFERENCES call_history(id) ON DELETE CASCADE,PRIMARY KEY(user_id,call_id));
CREATE TABLE session_details(
    token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,
    agent TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL);
CREATE INDEX session_details_seen ON session_details(last_seen);
CREATE TABLE contact_settings(owner INTEGER PRIMARY KEY REFERENCES users(id),enabled INTEGER NOT NULL DEFAULT 0,epoch INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 0,discovery TEXT NOT NULL DEFAULT 'everyone',presence TEXT NOT NULL DEFAULT 'everyone');
CREATE TABLE account_contacts(owner INTEGER NOT NULL REFERENCES users(id),id TEXT NOT NULL,linked INTEGER REFERENCES users(id),phones TEXT NOT NULL DEFAULT '[]',phonebook_name TEXT NOT NULL DEFAULT '',custom_name TEXT NOT NULL DEFAULT '',manual INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,id));
CREATE INDEX contact_links ON account_contacts(owner,linked,deleted);
CREATE TABLE contact_sources(owner INTEGER NOT NULL,device TEXT NOT NULL,source TEXT NOT NULL,contact_id TEXT NOT NULL,fingerprint TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(owner,device,source));
CREATE TABLE contact_devices(owner INTEGER NOT NULL,device TEXT NOT NULL,version INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(owner,device));
CREATE TABLE contact_queries(owner INTEGER NOT NULL,fingerprint TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,fingerprint));
CREATE TABLE contact_operations(owner INTEGER NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,key));
CREATE TABLE contact_secret(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL);
