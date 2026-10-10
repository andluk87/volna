import http from 'node:http';
import {initAdminSchema,readAdminSettings} from './admin-config.mjs';
import {createAdminServer} from './admin.mjs';
import { messaging } from './messaging.mjs';
import { notifications } from './push.mjs';
import { calls } from './calls.mjs';
import { mobile } from './mobile.mjs';
import { expressions } from './expressions.mjs';
import { profiles } from './profiles.mjs';
import { communities } from './communities.mjs';
import { topics,topicNotification } from './topics.mjs';
import { usernames } from './usernames.mjs';
import { phoneAuth } from './phone-auth.mjs';
import { createTranscriber } from './transcription.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomInt, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
export function createApp({ pushSender, phoneAuthOptions={}, adminOptions={}, transcriber=createTranscriber(), database = process.env.DB_PATH || './data/volna.db', uploads = process.env.UPLOAD_PATH || join(dirname(database === ':memory:' ? './data/volna.db' : database), 'uploads'), origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080,http://localhost:5173,https://localhost,app://volna').split(',') } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (legacy && !db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='phone')) {
    db.close(); throw Error('Legacy authentication database: run scripts/migrate-phone-auth.sh before starting 0.12.0. Backup is mandatory.');
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY, pair TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS members(chat_id INTEGER REFERENCES chats(id), user_id INTEGER REFERENCES users(id), last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(chat_id,user_id));
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES chats(id), sender_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, client_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(sender_id,client_id));
    CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id,id);
    CREATE INDEX IF NOT EXISTS members_user ON members(user_id,chat_id);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);`);
  // New IDs cannot accidentally reuse legacy Android cache/account IDs.
  if (!db.prepare("SELECT 1 FROM sqlite_sequence WHERE name='users'").get()) db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('users',?)").run(randomInt(1000000000,2000000000));
  initAdminSchema(db);
  const streams = new Map(), limits = new Map();
  const userById = (id,own=false) => {
    const row=db.prepare('SELECT id,username,name,bio,avatar_id,avatar_hidden,phone FROM users WHERE id=?').get(id);
    if(!row)return;
    const user={id:row.id,username:row.username,name:row.name,bio:row.bio,online:!!streams.get(row.id)?.size};
    if(own)user.phone=row.phone;
    user.avatar_url=row.avatar_hidden?null:row.avatar_id?`/api/files/${row.avatar_id}`:null;
    return usernameService?.decorate(user)||user;
  };
  let usernameService;
  let mobileService;
  const auth = req => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const session = db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(digest(token), Date.now());
    if (!session) throw fail(401, 'Войдите в аккаунт заново');
    if(db.prepare('SELECT admin_blocked FROM users WHERE id=?').get(session.user_id)?.admin_blocked)throw fail(403,'Аккаунт заблокирован администратором');
    mobileService?.touch(req,session);
    return session;
  };
  const member = (chat, user) => {
    if(db.prepare('SELECT admin_blocked FROM users WHERE id=?').get(user)?.admin_blocked)throw fail(403,'Аккаунт заблокирован администратором');
    if(db.prepare('SELECT admin_deleted FROM chats WHERE id=?').get(chat)?.admin_deleted)throw fail(404,'Чат удалён администратором');
    if (!db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').get(chat, user)) throw fail(404, 'Чат не найден');
  };
  const publish = (users, event) => {
    for (const id of users) for (const res of streams.get(id) || []) {
      if (!res.write(`data: ${JSON.stringify(event)}\n\n`)) res.end();
    }
  };
  let pushService;
  const broadcast = (chat, event) => {const users=db.prepare('SELECT user_id FROM members WHERE chat_id=?').all(chat).map(x=>x.user_id);if(['message','message-update'].includes(event.type)){for(const uid of users)publish([uid],{...event,notify:topicNotification(db,chat,uid,event.message.text)});if(event.type==='message')pushService?.message(chat,event.message);}else publish(users,event);};
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const body = async req => {
    if(req.volnaParsedBody){const data=req.volnaParsedBody;delete req.volnaParsedBody;return data;}
    let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 20000) throw fail(413, 'Слишком большой запрос'); }
    try { const value = JSON.parse(raw || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; } catch { throw fail(400, 'Некорректный JSON'); }
  };
  const limit = (key, max) => {
    const now = Date.now(); let item = limits.get(key);
    if (!item || item.until < now) { item = { count: 0, until: now + 60000 }; limits.set(key, item); }
    if (++item.count > max) throw fail(429, 'Слишком много запросов. Подождите минуту');
  };
  const disconnect=(uid,token)=>{for(const stream of streams.get(uid)||[])if(stream.sessionToken===token)stream.end();};
  const phoneService=phoneAuth({db,json,body,userById,auth,disconnect,loginCheck:(uid)=>{if(uid&&db.prepare('SELECT admin_blocked FROM users WHERE id=?').get(uid)?.admin_blocked)throw fail(403,'Аккаунт заблокирован администратором');if(!uid&&!readAdminSettings(db).registration_enabled)throw fail(403,'Регистрация новых пользователей временно закрыта');},...phoneAuthOptions});
  const handleProfiles = profiles({db,uploads,auth,publish,userById,json,body});
  usernameService=usernames({db,body,json,userById,publish,uploads});
  let expressionService;
  const handleMessaging = messaging({db,uploads,member,broadcast,userById,json,body,transcriber,expressions:()=>expressionService});
  expressionService=expressions({db,uploads,body,json,member,publish});
  handleMessaging.cleanupUnused();
  const handleCommunities = communities({db,member,broadcast,publish,json,body,userById,online:id=>!!streams.get(id)?.size});
  const handleTopics=topics({db,body,json,member,broadcast,publish});
  pushService = notifications({db,auth,body,json,sender:pushSender});
  const callService = calls({db,auth,body,json,userById,onRing:pushService.call,onEnd:pushService.endCall});
  mobileService=mobile({db,auth,body,json,userById,online:id=>!!streams.get(id)?.size,
    disconnect:(uid,token)=>{for(const stream of streams.get(uid)||[])if(stream.sessionToken===token)stream.end();}});
  const adminService=createAdminServer({db,uploads,json,body,publish,broadcast,hydrate:handleMessaging.hydrate,userById,disconnectUser:uid=>{for(const stream of streams.get(uid)||[])stream.end();},cleanupFiles:handleMessaging.cleanupUnused,callService,...adminOptions});
  const cleanup = setInterval(() => {
    const now = Date.now(); for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
    phoneService.cleanup(); adminService.cleanup();
    for (const list of streams.values()) for (const res of list) if (res.sessionExpires < now) res.end();
  }, 30000); cleanup.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    try {
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin)) throw fail(403, 'Источник запроса не разрешён');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials','true'); res.setHeader('Vary', 'Origin'); }
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const url = new URL(req.url, 'http://local'); const path = url.pathname; const method = req.method;
      if (path === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
      if (['/api/register','/api/login','/api/password'].includes(path) || path.startsWith('/api/auth/telegram/')) throw fail(404,'Этот способ входа удалён');
      if (path.startsWith('/api/auth/')) { if(await phoneService.handle(req,res,url))return; }
      if (url.pathname.startsWith("/api/public/users/")) { limit("public:"+req.socket.remoteAddress,120); if(await usernameService.publicHandle(req,res,url))return; }
      const session = auth(req), uid = session.user_id;
      adminService.guard(req,url,session);
      if (path === '/api/me' && method === 'GET') {
        const user=userById(uid,true);
        return json(res, 200, user);
      }
      if (path === '/api/logout' && method === 'POST') {
        res.setHeader('Set-Cookie','volna.refresh=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0');
        db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);
        for (const stream of streams.get(uid) || []) if (stream.sessionToken === session.token) stream.end();
        return json(res, 200, { ok: true });
      }
      if (path === '/api/events' && method === 'GET') {
        const list = streams.get(uid) || new Set(); if (list.size >= 8) throw fail(429, 'Слишком много подключений');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.sessionToken = session.token; res.sessionExpires = session.expires;
        list.add(res); streams.set(uid, list); res.write('data: {"type":"ready"}\n\n');
        const heartbeat = setInterval(() => { if (!res.write(': heartbeat\n\n')) res.end(); }, 20000);
        res.on('close', () => { clearInterval(heartbeat); list.delete(res); if (!list.size) streams.delete(uid); }); return;
      }
      limit(`user:${uid}`, 240);
      if (await mobileService.handle(req,res,url,session)) return;
      if (await pushService.handle(req,res,url,uid)) return;
      if (await callService.handle(req,res,url,uid)) return;
      if (await usernameService.handle(req,res,url,uid)) return;
      if (await handleProfiles(req,res,url,uid)) return;
      if (await handleTopics(req,res,url,uid)) return;
      if (await handleCommunities(req,res,url,uid)) return;
      if (await expressionService.handle(req,res,url,uid)) return;
      if (await handleMessaging(req,res,url,uid)) return;
      if (path === '/api/chats' && method === 'GET') {
        const rows = db.prepare(`SELECT c.id, me.last_read, other.last_read AS peer_read, u.id AS peer_id,u.name,u.username,
          (SELECT text FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_text,
          (SELECT created_at FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_at,
          (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND id>me.last_read AND sender_id<>?) AS unread
          FROM chats c JOIN members me ON me.chat_id=c.id AND me.user_id=?
          JOIN members other ON other.chat_id=c.id AND other.user_id<>? JOIN users u ON u.id=other.user_id
          ORDER BY COALESCE(last_at,'') DESC,c.id DESC`).all(uid, uid, uid);
        return json(res, 200, rows);
      }
      if (path === '/api/chats' && method === 'POST') {
        const { user_id } = await body(req); const peer = Number(user_id);
        if (!Number.isSafeInteger(peer) || peer === uid || !userById(peer)) throw fail(400, 'Пользователь не найден');
        const pair = [uid, peer].sort((a,b) => a-b).join(':');
        db.exec('BEGIN IMMEDIATE'); let chat;
        try { db.prepare('INSERT OR IGNORE INTO chats(pair) VALUES(?)').run(pair); chat = db.prepare('SELECT id FROM chats WHERE pair=?').get(pair);
          for (const id of [uid, peer]) db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').run(chat.id, id); db.exec('COMMIT');
        } catch(e) { db.exec('ROLLBACK'); throw e; }
        broadcast(chat.id, { type: 'chats' }); return json(res, 200, chat);
      }
      const match = path.match(/^\/api\/chats\/(\d+)\/(messages|read|delivered)$/);
      if (match) {
        const chat = Number(match[1]); member(chat, uid);
        if (match[2] === 'messages' && method === 'GET') {
          const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
          if (!Number.isSafeInteger(before) || before < 1) throw fail(400, 'Некорректный курсор');
          return json(res, 200, db.prepare('SELECT * FROM messages WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT 50').all(chat, before).reverse());
        }
        if (match[2] === 'messages' && method === 'POST') {
          const data = await body(req); const text = String(data.text || '').trim(); const client = String(data.client_id || '');
          if (!text || text.length > 4000 || !/^[a-zA-Z0-9-]{16,64}$/.test(client)) throw fail(400, 'Сообщение: 1–4000 символов; требуется client_id');
          const existing = db.prepare('SELECT * FROM messages WHERE sender_id=? AND client_id=?').get(uid, client);
          if (existing && (existing.chat_id !== chat || existing.text !== text)) throw fail(409, 'Идентификатор уже использован');
          if (existing) return json(res, 200, existing);
          const result = db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(chat, uid, text, client, new Date().toISOString());
          const message = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(result.lastInsertRowid));
          broadcast(chat, { type: 'message', message }); return json(res, 201, message);
        }
        if (match[2] === 'delivered' && method === 'POST') {
          const {message_id}=await body(req);member(chat,uid);
          if(!Number.isSafeInteger(message_id)||!db.prepare('SELECT 1 FROM messages WHERE id=? AND chat_id=?').get(message_id,chat))throw fail(400,'Сообщение не найдено');
          const old=db.prepare('SELECT last_delivered FROM members WHERE chat_id=? AND user_id=?').get(chat,uid).last_delivered;
          if(message_id>old){db.prepare('UPDATE members SET last_delivered=? WHERE chat_id=? AND user_id=?').run(message_id,chat,uid);broadcast(chat,{type:'delivered',chat_id:chat});}
          return json(res,200,{ok:true});
        }
        if (match[2] === 'read' && method === 'POST') {
          const { message_id } = await body(req); const id = Number(message_id);
          if (!Number.isSafeInteger(id) || !db.prepare('SELECT 1 FROM messages WHERE id=? AND chat_id=?').get(id, chat)) throw fail(400, 'Сообщение не найдено');
          db.prepare('UPDATE members SET last_read=MAX(last_read,?) WHERE chat_id=? AND user_id=?').run(id, chat, uid);
          broadcast(chat, { type: 'read', chat_id: chat, user_id: uid, message_id: id }); return json(res, 200, { ok: true });
        }
      }
      throw fail(404, 'Не найдено');
    } catch(e) { if (!e.status) console.error(e); if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Ошибка сервера', ...(e.status&&e.suggestions?{suggestions:e.suggestions}:{}) }); else res.end(); }
  });
  server.requestTimeout = 120000; server.headersTimeout = 15000;
  return { server, adminServer:adminService.server, db, push:pushService, close: async () => { await adminService.close();callService.close();clearInterval(cleanup);await pushService.close(); for (const list of streams.values()) for (const res of list) res.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp(); app.server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Volna API listening on :'+(process.env.PORT || 3000)));
  app.adminServer.listen(Number(process.env.ADMIN_PORT||8998),'0.0.0.0',()=>console.log('Volna admin listening on :'+(process.env.ADMIN_PORT||8998)));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
