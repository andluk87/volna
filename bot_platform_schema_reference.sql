-- Bot Platform / reference PostgreSQL schema / v1.0
-- REFERENCE ONLY: adapt UUID user/account/chat IDs and FK names to the actual messenger.
-- External tables assumed: accounts(id uuid), chats(id uuid), messages(id uuid).
-- Do not run unchanged against production. Author/review proper migrations.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  username varchar(64) NOT NULL,
  display_name varchar(128) NOT NULL,
  description text NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  execution_mode varchar(16) NOT NULL DEFAULT 'external' CHECK (execution_mode IN ('external','hosted')),
  avatar_file_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bots_username_normalized_unique ON bots (lower(username));
CREATE INDEX bots_owner_status_idx ON bots (owner_id,status);

CREATE TABLE bot_members (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role varchar(16) NOT NULL CHECK (role IN ('owner','maintainer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bot_id,user_id)
);

CREATE TABLE bot_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id),
  token_prefix varchar(32) NOT NULL UNIQUE,
  secret_digest bytea NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  last_used_at timestamptz NULL
);
CREATE INDEX bot_tokens_active_lookup ON bot_tokens(bot_id) WHERE revoked_at IS NULL;

CREATE TABLE bot_delivery_state (
  bot_id uuid PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  mode varchar(16) NOT NULL DEFAULT 'polling' CHECK (mode IN ('webhook','polling','hosted')),
  generation bigint NOT NULL DEFAULT 1,
  confirmed_update_id bigint NOT NULL DEFAULT 0,
  next_update_id bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (next_update_id > confirmed_update_id)
);

CREATE TABLE bot_webhooks (
  bot_id uuid PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret_ref text NOT NULL,
  subscribed_types text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 1,
  last_error_code varchar(128),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bot_chat_grants (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL,
  visibility varchar(16) NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('restricted','full_read')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  PRIMARY KEY(bot_id,chat_id)
);
CREATE INDEX bot_chat_grants_chat_idx ON bot_chat_grants(chat_id) WHERE revoked_at IS NULL;

CREATE TABLE bot_updates (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  update_id bigint NOT NULL CHECK(update_id > 0),
  event_id varchar(80) NOT NULL,
  event_type varchar(80) NOT NULL,
  chat_id uuid NULL,
  chat_sequence bigint NULL,
  payload jsonb NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','acked','expired','failed')),
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  acked_at timestamptz NULL,
  PRIMARY KEY(bot_id,update_id),
  UNIQUE(bot_id,event_id)
);
CREATE INDEX bot_updates_pending_idx ON bot_updates (bot_id,state,expires_at,update_id);
CREATE INDEX bot_updates_expiry_idx ON bot_updates(expires_at);

CREATE TABLE bot_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL,
  update_id bigint NOT NULL,
  attempt integer NOT NULL CHECK(attempt > 0),
  transport varchar(16) NOT NULL CHECK(transport IN ('webhook','hosted')),
  status_code integer NULL,
  error_code varchar(128) NULL,
  elapsed_ms integer NULL,
  next_retry_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(bot_id,update_id) REFERENCES bot_updates(bot_id,update_id) ON DELETE CASCADE,
  UNIQUE(bot_id,update_id,attempt)
);
CREATE INDEX bot_delivery_attempts_retry_idx ON bot_delivery_attempts(next_retry_at) WHERE next_retry_at IS NOT NULL;

CREATE TABLE bot_commands (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  command varchar(32) NOT NULL,
  locale varchar(16) NOT NULL DEFAULT 'default',
  description varchar(256) NOT NULL,
  PRIMARY KEY(bot_id,command,locale)
);

CREATE TABLE bot_callback_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL,
  message_id uuid NOT NULL,
  button_id varchar(64) NOT NULL,
  callback_data varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz NULL,
  revoked_at timestamptz NULL,
  UNIQUE(message_id,button_id)
);
CREATE INDEX bot_callback_actions_bot_msg_idx ON bot_callback_actions(bot_id,message_id);

CREATE TABLE bot_callback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES bot_callback_actions(id),
  actor_id uuid NOT NULL,
  client_nonce varchar(128) NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','answered','expired')),
  expires_at timestamptz NOT NULL,
  answered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id,client_nonce)
);

CREATE TABLE bot_idempotency (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  method varchar(16) NOT NULL,
  resource varchar(256) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  request_hash bytea NOT NULL,
  response_body jsonb NULL,
  response_status integer NULL,
  state varchar(16) NOT NULL CHECK(state IN ('processing','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(bot_id,method,resource,idempotency_key)
);
CREATE INDEX bot_idempotency_expire_idx ON bot_idempotency(expires_at);

CREATE TABLE bot_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  artifact_digest varchar(128) NOT NULL,
  runtime varchar(64) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL CHECK(status IN('uploaded','building','failed','ready','deploying','active','rollback','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NULL,
  created_by uuid NOT NULL
);
CREATE INDEX bot_deployments_history ON bot_deployments(bot_id,created_at DESC);

CREATE TABLE bot_runtime_secrets (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name varchar(128) NOT NULL,
  encrypted_secret_ref text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bot_id,name)
);

CREATE TABLE bot_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id),
  actor_id uuid NULL,
  action varchar(128) NOT NULL,
  diff_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_digest bytea NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bot_audit_logs_bot_time ON bot_audit_logs(bot_id,created_at DESC);

CREATE TABLE event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(64) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL
);
CREATE INDEX event_outbox_unpublished ON event_outbox(created_at) WHERE published_at IS NULL;

COMMIT;

-- Implementation invariants:
-- 1. Allocate update_id in a transaction after SELECT ... FOR UPDATE on bot_delivery_state.
-- 2. Event fanout must recheck group permissions and encryption mode.
-- 3. outbox write + core message write must occur in the same core DB transaction.
-- 4. Before enabling hosted deployments, enforce microVM/runtime isolation and network egress restrictions.
-- 5. Deletion/retention/partitioning depend on the actual legal and operational requirements.
