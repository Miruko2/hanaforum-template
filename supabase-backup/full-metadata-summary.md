# Supabase Full Metadata Summary

Generated from snapshot: supabase-backup\full-metadata.json
Snapshot generated at: 2026-05-31T05:18:16.486Z

## Tables

### admin_users

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| user_id | uuid (uuid) | no |  |
| added_by | uuid (uuid) | yes |  |
| created_at | timestamp with time zone (timestamptz) | yes | now() |

Constraints:
- admin_users_added_by_fkey: f
  FOREIGN KEY (added_by) REFERENCES auth.users(id)
- admin_users_pkey: p
  PRIMARY KEY (id)
- admin_users_user_id_fkey: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- admin_users_user_id_key: u
  UNIQUE (user_id)

Indexes:
- admin_users_pkey: `CREATE UNIQUE INDEX admin_users_pkey ON public.admin_users USING btree (id)`
- admin_users_user_id_key: `CREATE UNIQUE INDEX admin_users_user_id_key ON public.admin_users USING btree (user_id)`

RLS policies:
- admin_users_insert
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.uid() = '4345c6d0-05eb-4bc3-ba50-1cfa1dee2c41'::uuid)
- admin_users_select
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true

### admins

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| user_id | uuid (uuid) | no |  |
| created_at | timestamp with time zone (timestamptz) | yes | now() |
| updated_at | timestamp with time zone (timestamptz) | yes | now() |

Constraints:
- admins_pkey: p
  PRIMARY KEY (id)
- admins_user_id_fkey: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:
- admins_pkey: `CREATE UNIQUE INDEX admins_pkey ON public.admins USING btree (id)`
- admins_user_id_idx: `CREATE UNIQUE INDEX admins_user_id_idx ON public.admins USING btree (user_id)`

RLS policies:
- admin_insert_policy
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.uid() IN ( SELECT admins_1.user_id
   FROM admins admins_1
  WHERE (admins_1.user_id = '00000000-0000-0000-0000-000000000000'::uuid)))
- admin_select_policy
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() IN ( SELECT admins_1.user_id
   FROM admins admins_1))

### ai_config

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | integer (int4) | no | 1 |
| base_url | text (text) | no | 'https://api.deepseek.com/v1'::text |
| api_key | text (text) | no | ''::text |
| model | text (text) | no | 'deepseek-chat'::text |
| updated_at | timestamp with time zone (timestamptz) | yes | now() |
| updated_by | uuid (uuid) | yes |  |

Constraints:
- ai_config_id_check: c
  CHECK (id = 1)
- ai_config_pkey: p
  PRIMARY KEY (id)

Indexes:
- ai_config_pkey: `CREATE UNIQUE INDEX ai_config_pkey ON public.ai_config USING btree (id)`

### comment_likes

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| comment_id | uuid (uuid) | no |  |
| user_id | uuid (uuid) | no |  |
| created_at | timestamp with time zone (timestamptz) | no | now() |

Constraints:
- comment_likes_comment_id_user_id_key: u
  UNIQUE (comment_id, user_id)
- comment_likes_pkey: p
  PRIMARY KEY (id)
- fk_comment_likes_comment_id: f
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
- fk_comment_likes_user_id: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:
- comment_likes_comment_id_user_id_key: `CREATE UNIQUE INDEX comment_likes_comment_id_user_id_key ON public.comment_likes USING btree (comment_id, user_id)`
- comment_likes_pkey: `CREATE UNIQUE INDEX comment_likes_pkey ON public.comment_likes USING btree (id)`
- idx_comment_likes_comment_id: `CREATE INDEX idx_comment_likes_comment_id ON public.comment_likes USING btree (comment_id)`
- idx_comment_likes_comment_user_unique: `CREATE UNIQUE INDEX idx_comment_likes_comment_user_unique ON public.comment_likes USING btree (comment_id, user_id)`
- idx_comment_likes_user_id: `CREATE INDEX idx_comment_likes_user_id ON public.comment_likes USING btree (user_id)`

RLS policies:
- 评论点赞对所有人可见
  Command: SELECT; roles: anon, authenticated; permissive: PERMISSIVE
  USING: true
- 评论点赞可被创建者删除
  Command: DELETE; roles: authenticated; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)
- 评论点赞可被已认证用户创建
  Command: INSERT; roles: authenticated; permissive: PERMISSIVE
  WITH CHECK: true

### comments

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| user_id | uuid (uuid) | yes |  |
| post_id | uuid (uuid) | yes |  |
| content | text (text) | no |  |
| created_at | timestamp with time zone (timestamptz) | yes | now() |
| parent_id | uuid (uuid) | yes |  |

Constraints:
- comments_parent_id_fkey: f
  FOREIGN KEY (parent_id) REFERENCES comments(id)
- comments_pkey: p
  PRIMARY KEY (id)
- comments_post_id_fkey: f
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE

Indexes:
- comments_pkey: `CREATE UNIQUE INDEX comments_pkey ON public.comments USING btree (id)`
- idx_comments_created_at: `CREATE INDEX idx_comments_created_at ON public.comments USING btree (created_at DESC)`
- idx_comments_parent_id: `CREATE INDEX idx_comments_parent_id ON public.comments USING btree (parent_id)`
- idx_comments_post_created: `CREATE INDEX idx_comments_post_created ON public.comments USING btree (post_id, created_at DESC)`
- idx_comments_post_id: `CREATE INDEX idx_comments_post_id ON public.comments USING btree (post_id)`
- idx_comments_post_parent: `CREATE INDEX idx_comments_post_parent ON public.comments USING btree (post_id, parent_id)`
- idx_comments_user_created: `CREATE INDEX idx_comments_user_created ON public.comments USING btree (user_id, created_at DESC)`
- idx_comments_user_id: `CREATE INDEX idx_comments_user_id ON public.comments USING btree (user_id)`

RLS policies:
- comments_delete
  Command: DELETE; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)
- comments_insert
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.uid() = user_id)
- comments_select
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true
- comments_update
  Command: UPDATE; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)

Triggers:
- update_comments_updated_at: BEFORE UPDATE EXECUTE FUNCTION update_updated_at_column()

### hanako_allowed_users

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | gen_random_uuid() |
| user_id | uuid (uuid) | no |  |
| added_by | uuid (uuid) | yes |  |
| created_at | timestamp with time zone (timestamptz) | yes | now() |

Constraints:
- hanako_allowed_users_pkey: p
  PRIMARY KEY (id)
- hanako_allowed_users_user_id_key: u
  UNIQUE (user_id)

Indexes:
- hanako_allowed_users_pkey: `CREATE UNIQUE INDEX hanako_allowed_users_pkey ON public.hanako_allowed_users USING btree (id)`
- hanako_allowed_users_user_id_key: `CREATE UNIQUE INDEX hanako_allowed_users_user_id_key ON public.hanako_allowed_users USING btree (user_id)`
- idx_hanako_allowed_users_user_id: `CREATE INDEX idx_hanako_allowed_users_user_id ON public.hanako_allowed_users USING btree (user_id)`

RLS policies:
- Allow delete for authenticated
  Command: DELETE; roles: public; permissive: PERMISSIVE
  USING: (auth.role() = 'authenticated'::text)
- Allow insert for authenticated
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.role() = 'authenticated'::text)
- Allow read for all
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true

### likes

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| user_id | uuid (uuid) | yes |  |
| post_id | uuid (uuid) | yes |  |
| created_at | timestamp with time zone (timestamptz) | yes | now() |

Constraints:
- likes_pkey: p
  PRIMARY KEY (id)
- likes_post_id_fkey: f
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
- likes_user_id_post_id_key: u
  UNIQUE (user_id, post_id)

Indexes:
- idx_likes_post_id: `CREATE INDEX idx_likes_post_id ON public.likes USING btree (post_id)`
- idx_likes_post_user_unique: `CREATE UNIQUE INDEX idx_likes_post_user_unique ON public.likes USING btree (post_id, user_id)`
- idx_likes_user_id: `CREATE INDEX idx_likes_user_id ON public.likes USING btree (user_id)`
- likes_pkey: `CREATE UNIQUE INDEX likes_pkey ON public.likes USING btree (id)`
- likes_user_id_post_id_key: `CREATE UNIQUE INDEX likes_user_id_post_id_key ON public.likes USING btree (user_id, post_id)`

RLS policies:
- likes_delete
  Command: DELETE; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)
- likes_insert
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.uid() = user_id)
- likes_select
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true

### live_comments

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false
- Comment: 全站弹幕聊天墙，任何登录用户可发，匿名可读

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | gen_random_uuid() |
| user_id | uuid (uuid) | no |  |
| username | text (text) | no |  |
| content | text (text) | no |  |
| created_at | timestamp with time zone (timestamptz) | no | now() |

Constraints:
- live_comments_content_check: c
  CHECK (char_length(content) > 0 AND char_length(content) <= 200)
- live_comments_pkey: p
  PRIMARY KEY (id)
- live_comments_user_id_fkey: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:
- idx_live_comments_created_at: `CREATE INDEX idx_live_comments_created_at ON public.live_comments USING btree (created_at DESC)`
- live_comments_pkey: `CREATE UNIQUE INDEX live_comments_pkey ON public.live_comments USING btree (id)`

RLS policies:
- live_comments_delete_admin
  Command: DELETE; roles: public; permissive: PERMISSIVE
  USING: (EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.user_id = auth.uid())))
- live_comments_insert_own
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: ((auth.uid() = user_id) AND (( SELECT count(*) AS count
   FROM live_comments live_comments_1
  WHERE ((live_comments_1.user_id = auth.uid()) AND (live_comments_1.created_at > (now() - '00:00:03'::interval)))) < 2))
- live_comments_read_all
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true

### notifications

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| user_id | uuid (uuid) | no |  |
| type | character varying (varchar) | no |  |
| post_id | uuid (uuid) | yes |  |
| comment_id | uuid (uuid) | yes |  |
| actor_id | uuid (uuid) | yes |  |
| message | text (text) | no |  |
| is_read | boolean (bool) | no | false |
| created_at | timestamp with time zone (timestamptz) | yes | now() |

Constraints:
- notifications_actor_id_fkey: f
  FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL
- notifications_comment_id_fkey: f
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
- notifications_pkey: p
  PRIMARY KEY (id)
- notifications_post_id_fkey: f
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
- notifications_type_check: c
  CHECK (type::text = ANY (ARRAY['like_post'::character varying::text, 'comment_post'::character varying::text, 'like_comment'::character varying::text]))
- notifications_user_id_fkey: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- valid_notification_type: c
  CHECK (type::text = 'like_post'::text AND post_id IS NOT NULL AND comment_id IS NULL OR type::text = 'comment_post'::text AND post_id IS NOT NULL AND comment_id IS NULL OR type::text = 'like_comment'::text AND comment_id IS NOT NULL)

Indexes:
- idx_notifications_actor_id: `CREATE INDEX idx_notifications_actor_id ON public.notifications USING btree (actor_id)`
- idx_notifications_comment_id: `CREATE INDEX idx_notifications_comment_id ON public.notifications USING btree (comment_id) WHERE (comment_id IS NOT NULL)`
- idx_notifications_created_at: `CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at)`
- idx_notifications_is_read: `CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read) WHERE (is_read = false)`
- idx_notifications_post_id: `CREATE INDEX idx_notifications_post_id ON public.notifications USING btree (post_id) WHERE (post_id IS NOT NULL)`
- idx_notifications_type: `CREATE INDEX idx_notifications_type ON public.notifications USING btree (type)`
- idx_notifications_user_created: `CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC)`
- idx_notifications_user_id: `CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id)`
- idx_notifications_user_read: `CREATE INDEX idx_notifications_user_read ON public.notifications USING btree (user_id, is_read)`
- notifications_pkey: `CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)`

RLS policies:
- 通知只对接收者可见
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)
- 通知只能由接收者更新
  Command: UPDATE; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)
- 通知只能由系统创建
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: true
- 用户可查看自己的通知
  Command: SELECT; roles: authenticated; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)
- 用户可更新自己的通知
  Command: UPDATE; roles: authenticated; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)
- enable_all_access_notifications
  Command: ALL; roles: public; permissive: PERMISSIVE
  USING: true
  WITH CHECK: true

### operation_logs

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| operation_type | text (text) | no |  |
| user_id | uuid (uuid) | no |  |
| target_id | uuid (uuid) | yes |  |
| is_admin_operation | boolean (bool) | yes | false |
| details | jsonb (jsonb) | yes |  |
| created_at | timestamp with time zone (timestamptz) | yes | now() |

Constraints:
- operation_logs_pkey: p
  PRIMARY KEY (id)

Indexes:
- operation_logs_pkey: `CREATE UNIQUE INDEX operation_logs_pkey ON public.operation_logs USING btree (id)`

RLS policies:
- 管理员可以查看操作日志
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() IN ( SELECT admin_users.user_id
   FROM admin_users))
- 已认证用户可以创建操作日志
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.uid() IS NOT NULL)

### pinned_posts

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false
- Comment: 存储置顶帖子元数据，避免修改原始posts表结构

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| post_id | uuid (uuid) | no |  |
| pinned_at | timestamp with time zone (timestamptz) | yes | now() |
| pinned_by | uuid (uuid) | yes |  |

Constraints:
- pinned_posts_pinned_by_fkey: f
  FOREIGN KEY (pinned_by) REFERENCES auth.users(id) ON DELETE SET NULL
- pinned_posts_pkey: p
  PRIMARY KEY (post_id)
- pinned_posts_post_id_fkey: f
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE

Indexes:
- idx_pinned_posts_pinned_at: `CREATE INDEX idx_pinned_posts_pinned_at ON public.pinned_posts USING btree (pinned_at DESC)`
- pinned_posts_pkey: `CREATE UNIQUE INDEX pinned_posts_pkey ON public.pinned_posts USING btree (post_id)`

RLS policies:
- 管理员可管理置顶帖子
  Command: ALL; roles: public; permissive: PERMISSIVE
  USING: (EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.user_id = auth.uid())))
- 所有人可查看置顶帖子
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true

### posts

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| user_id | uuid (uuid) | yes |  |
| title | text (text) | no |  |
| category | text (text) | no |  |
| description | text (text) | yes |  |
| image_url | text (text) | yes |  |
| image_ratio | double precision (float8) | yes | 1.0 |
| likes_count | integer (int4) | yes | 0 |
| comments_count | integer (int4) | yes | 0 |
| created_at | timestamp with time zone (timestamptz) | yes | now() |
| content | text (text) | yes |  |
| likes | integer (int4) | yes | 0 |
| comments | integer (int4) | yes | 0 |
| updated_at | timestamp with time zone (timestamptz) | no | CURRENT_TIMESTAMP |

Constraints:
- fk_posts_auth_user: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE SET NULL
- fk_posts_profiles: f
  FOREIGN KEY (user_id) REFERENCES profiles(id)
- fk_user: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE SET NULL
- posts_pkey: p
  PRIMARY KEY (id)
- posts_user_id_fkey: f
  FOREIGN KEY (user_id) REFERENCES auth.users(id)

Indexes:
- idx_posts_category: `CREATE INDEX idx_posts_category ON public.posts USING btree (category)`
- idx_posts_category_created_at: `CREATE INDEX idx_posts_category_created_at ON public.posts USING btree (category, created_at DESC)`
- idx_posts_created_at: `CREATE INDEX idx_posts_created_at ON public.posts USING btree (created_at DESC)`
- idx_posts_user_id: `CREATE INDEX idx_posts_user_id ON public.posts USING btree (user_id)`
- idx_posts_user_id_created_at: `CREATE INDEX idx_posts_user_id_created_at ON public.posts USING btree (user_id, created_at DESC)`
- posts_pkey: `CREATE UNIQUE INDEX posts_pkey ON public.posts USING btree (id)`

RLS policies:
- posts_delete
  Command: DELETE; roles: public; permissive: PERMISSIVE
  USING: ((auth.uid() = user_id) OR (auth.uid() = '4345c6d0-05eb-4bc3-ba50-1cfa1dee2c41'::uuid))
- posts_insert
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.uid() = user_id)
- posts_select
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true
- posts_update
  Command: UPDATE; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() = user_id)

Triggers:
- update_posts_modtime: BEFORE UPDATE EXECUTE FUNCTION update_modified_column()
- update_posts_updated_at: BEFORE UPDATE EXECUTE FUNCTION update_updated_at_column()

### posts_with_users

- Kind: v
- Owner: postgres
- RLS enabled: false
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | yes |  |
| user_id | uuid (uuid) | yes |  |
| title | text (text) | yes |  |
| category | text (text) | yes |  |
| description | text (text) | yes |  |
| image_url | text (text) | yes |  |
| image_ratio | double precision (float8) | yes |  |
| likes_count | integer (int4) | yes |  |
| comments_count | integer (int4) | yes |  |
| created_at | timestamp with time zone (timestamptz) | yes |  |
| content | text (text) | yes |  |
| likes | integer (int4) | yes |  |
| comments | integer (int4) | yes |  |
| user_email | character varying (varchar) | yes |  |

### profiles

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no |  |
| username | text (text) | yes |  |
| updated_at | timestamp with time zone (timestamptz) | yes |  |
| full_name | text (text) | yes |  |
| avatar_url | text (text) | yes |  |
| website | text (text) | yes |  |

Constraints:
- profiles_id_fkey: f
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
- profiles_pkey: p
  PRIMARY KEY (id)
- profiles_username_key: u
  UNIQUE (username)

Indexes:
- idx_profiles_username: `CREATE INDEX idx_profiles_username ON public.profiles USING btree (username)`
- profiles_pkey: `CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)`
- profiles_username_key: `CREATE UNIQUE INDEX profiles_username_key ON public.profiles USING btree (username)`

RLS policies:
- profiles_insert
  Command: INSERT; roles: public; permissive: PERMISSIVE
  WITH CHECK: (auth.uid() = id)
- profiles_select
  Command: SELECT; roles: public; permissive: PERMISSIVE
  USING: true
- profiles_update
  Command: UPDATE; roles: public; permissive: PERMISSIVE
  USING: (auth.uid() = id)

Triggers:
- update_profiles_updated_at: BEFORE UPDATE EXECUTE FUNCTION update_updated_at_column()

### safe_posts

- Kind: v
- Owner: postgres
- RLS enabled: false
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | yes |  |
| title | text (text) | yes |  |
| content | text (text) | yes |  |
| category | text (text) | yes |  |
| description | text (text) | yes |  |
| image_url | text (text) | yes |  |
| image_ratio | double precision (float8) | yes |  |
| likes_count | integer (int4) | yes |  |
| comments_count | integer (int4) | yes |  |
| created_at | timestamp with time zone (timestamptz) | yes |  |
| username | text (text) | yes |  |
| avatar_url | text (text) | yes |  |

### user_profiles

- Kind: v
- Owner: postgres
- RLS enabled: false
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| user_id | uuid (uuid) | yes |  |
| username | text (text) | yes |  |
| avatar_url | text (text) | yes |  |

### users

- Kind: r
- Owner: postgres
- RLS enabled: true
- RLS forced: false

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid (uuid) | no | uuid_generate_v4() |
| username | text (text) | no |  |
| email | text (text) | no |  |
| password | text (text) | yes |  |
| avatar_url | text (text) | yes |  |
| created_at | timestamp with time zone (timestamptz) | yes | now() |

Constraints:
- users_email_key: u
  UNIQUE (email)
- users_pkey: p
  PRIMARY KEY (id)
- users_username_key: u
  UNIQUE (username)

Indexes:
- users_email_key: `CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)`
- users_pkey: `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`
- users_username_key: `CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username)`

## Functions

- add_admin_by_email(p_email text) -> boolean; security definer: true
- add_comment(p_post_id uuid, p_user_id uuid, p_content text, p_parent_id uuid) -> uuid; security definer: false
- add_initial_admin(admin_user_id uuid) -> void; security definer: true
- create_post(p_title text, p_content text, p_description text, p_category text, p_image_url text, p_image_ratio double precision, p_user_id uuid) -> jsonb; security definer: true
- decrement(x integer) -> integer; security definer: false
- delete_post_admin(p_post_id uuid, p_user_id uuid, p_is_admin boolean) -> boolean; security definer: true
- delete_post(p_post_id uuid, p_user_id uuid) -> void; security definer: true
- get_all_posts() -> SETOF json; security definer: true
- get_posts_with_users() -> TABLE(id uuid, created_at timestamp with time zone, user_id uuid, title text, category text, description text, image_url text, username text, email text); security definer: true
- get_table_info(table_name text) -> json; security definer: false
- handle_new_user() -> trigger; security definer: true
- increment(x integer) -> integer; security definer: false
- like_post(p_post_id uuid, p_user_id uuid) -> void; security definer: false
- list_posts(limits integer DEFAULT 20, offsets integer DEFAULT 0, category_filter text DEFAULT NULL::text) -> TABLE(id uuid, title text, description text, image_url text, image_ratio double precision, category text, created_at timestamp with time zone, user_id uuid, username text, likes_count bigint, comments_count bigint); security definer: false
- search_user_by_email(p_email text) -> SETOF auth.users; security definer: true
- unlike_post(p_post_id uuid, p_user_id uuid) -> void; security definer: false
- update_modified_column() -> trigger; security definer: false
- update_updated_at_column() -> trigger; security definer: false

## Realtime Publication Tables

- public.comment_likes
- public.comments
- public.likes
- public.live_comments
- public.notifications
- public.posts

## Storage Buckets

- avatars: public=true; file_size_limit=
- images: public=true; file_size_limit=
- post-images: public=true; file_size_limit=
