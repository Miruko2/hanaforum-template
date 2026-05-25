# Supabase Public Schema Snapshot

Generated at: 2026-05-18T08:52:18.455Z
Supabase URL: https://uvkupdbfbnodeybulczd.supabase.co

This snapshot is exported from Supabase PostgREST OpenAPI metadata. It includes exposed public tables, columns, and RPC endpoints, but it does not include RLS policies, indexes, triggers, grants, or function bodies.

For the complete metadata export, run `supabase-backup/export-full-metadata.sql` in the Supabase SQL Editor.

## Tables

### admin_users

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| added_by | string | no | uuid | Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |
| created_at | string | no | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| user_id | string | yes | uuid | Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |

### admins

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| created_at | string | no | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| updated_at | string | no | timestamp with time zone |  |
| user_id | string | yes | uuid | Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |

### comment_likes

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| comment_id | string | yes | uuid | Note: This is a Foreign Key to `comments.id`.<fk table='comments' column='id'/> |
| created_at | string | yes | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| user_id | string | yes | uuid | Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |

### comments

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| content | string | yes | text |  |
| created_at | string | no | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| parent_id | string | no | uuid | Note: This is a Foreign Key to `comments.id`.<fk table='comments' column='id'/> |
| post_id | string | no | uuid | Note: This is a Foreign Key to `posts.id`.<fk table='posts' column='id'/> |
| user_id | string | no | uuid |  |

### hanako_allowed_users

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| added_by | string | no | uuid |  |
| created_at | string | no | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| user_id | string | yes | uuid |  |

### likes

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| created_at | string | no | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| post_id | string | no | uuid | Note: This is a Foreign Key to `posts.id`.<fk table='posts' column='id'/> |
| user_id | string | no | uuid |  |

### live_comments

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| content | string | yes | text |  |
| created_at | string | yes | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| user_id | string | yes | uuid | Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |
| username | string | yes | text |  |

### notifications

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| actor_id | string | no | uuid | Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |
| comment_id | string | no | uuid | Note: This is a Foreign Key to `comments.id`.<fk table='comments' column='id'/> |
| created_at | string | no | timestamp with time zone |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| is_read | boolean | yes | boolean |  |
| message | string | yes | text |  |
| post_id | string | no | uuid | Note: This is a Foreign Key to `posts.id`.<fk table='posts' column='id'/> |
| type | string | yes | character varying |  |
| user_id | string | yes | uuid | Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |

### operation_logs

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| created_at | string | no | timestamp with time zone |  |
| details |  | no | jsonb |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| is_admin_operation | boolean | no | boolean |  |
| operation_type | string | yes | text |  |
| target_id | string | no | uuid |  |
| user_id | string | yes | uuid |  |

### pinned_posts

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| pinned_at | string | no | timestamp with time zone | 置顶时间 |
| pinned_by | string | no | uuid | 执行置顶操作的管理员ID  Note: This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |
| post_id | string | yes | uuid | 被置顶的帖子ID  Note: This is a Primary Key.<pk/> This is a Foreign Key to `posts.id`.<fk table='posts' column='id'/> |

### posts

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| category | string | yes | text |  |
| comments | integer | no | integer |  |
| comments_count | integer | no | integer |  |
| content | string | no | text |  |
| created_at | string | no | timestamp with time zone |  |
| description | string | no | text |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| image_ratio | number | no | double precision |  |
| image_url | string | no | text |  |
| likes | integer | no | integer |  |
| likes_count | integer | no | integer |  |
| title | string | yes | text |  |
| updated_at | string | yes | timestamp with time zone |  |
| user_id | string | no | uuid | Note: This is a Foreign Key to `profiles.id`.<fk table='profiles' column='id'/> |

### posts_with_users

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| category | string | no | text |  |
| comments | integer | no | integer |  |
| comments_count | integer | no | integer |  |
| content | string | no | text |  |
| created_at | string | no | timestamp with time zone |  |
| description | string | no | text |  |
| id | string | no | uuid | Note: This is a Primary Key.<pk/> |
| image_ratio | number | no | double precision |  |
| image_url | string | no | text |  |
| likes | integer | no | integer |  |
| likes_count | integer | no | integer |  |
| title | string | no | text |  |
| user_email | string | no | character varying |  |
| user_id | string | no | uuid | Note: This is a Foreign Key to `profiles.id`.<fk table='profiles' column='id'/> |

### profiles

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| avatar_url | string | no | text |  |
| full_name | string | no | text |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> This is a Foreign Key to `user_profiles.user_id`.<fk table='user_profiles' column='user_id'/> |
| updated_at | string | no | timestamp with time zone |  |
| username | string | no | text |  |
| website | string | no | text |  |

### safe_posts

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| avatar_url | string | no | text |  |
| category | string | no | text |  |
| comments_count | integer | no | integer |  |
| content | string | no | text |  |
| created_at | string | no | timestamp with time zone |  |
| description | string | no | text |  |
| id | string | no | uuid | Note: This is a Primary Key.<pk/> |
| image_ratio | number | no | double precision |  |
| image_url | string | no | text |  |
| likes_count | integer | no | integer |  |
| title | string | no | text |  |
| username | string | no | text |  |

### user_profiles

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| avatar_url | string | no | text |  |
| user_id | string | no | uuid | Note: This is a Primary Key.<pk/> |
| username | string | no | text |  |

### users

| Column | Type | Required | Format | Description |
| --- | --- | --- | --- | --- |
| avatar_url | string | no | text |  |
| created_at | string | no | timestamp with time zone |  |
| email | string | yes | text |  |
| id | string | yes | uuid | Note: This is a Primary Key.<pk/> |
| password | string | no | text |  |
| username | string | yes | text |  |

## RPC Endpoints

- add_admin_by_email
- add_comment
- add_initial_admin
- create_post
- decrement
- delete_post
- delete_post_admin
- get_all_posts
- get_posts_with_users
- get_table_info
- increment
- like_post
- list_posts
- search_user_by_email
- unlike_post
