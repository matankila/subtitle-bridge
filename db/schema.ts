import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const subtitleRequests = sqliteTable('subtitle_requests', {
  id: text('id').primaryKey(), created: integer('created').notNull(), updated: integer('updated').notNull(),
  mediaType: text('media_type').notNull(), mediaId: text('media_id').notNull(), target: text('target').notNull(),
  origin: text('origin').notNull(), filename: text('filename').notNull(), release: text('release').notNull().default(''),
  state: text('state').notNull(), jobId: text('job_id'), errorCode: text('error_code'), message: text('message'),
  durationMs: integer('duration_ms'), expires: integer('expires').notNull(),
  hits: integer('hits').notNull().default(1), lastSeen: integer('last_seen').notNull().default(0), duplicateOf: text('duplicate_of'),
},table=>[index('subtitle_requests_created_idx').on(table.created,table.id),index('subtitle_requests_job_idx').on(table.jobId),index('subtitle_requests_expires_idx').on(table.expires)]);
export const configs = sqliteTable('configs', {
  id: text('id').primaryKey(), target: text('target').notNull(), email: text('email').notNull(),
  created: integer('created').notNull(),
},table=>[index('configs_created_idx').on(table.created)]);
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(), cacheKey: text('cache_key').notNull().unique(),
  target: text('target').notNull(), email: text('email').notNull(),
  userIp: text('user_ip'),
  data: text('data').notNull(), state: text('state').notNull(), error: text('error'),
  lease: text('lease'), leaseUntil: integer('lease_until').notNull().default(0),
  created: integer('created').notNull(), expires: integer('expires').notNull(),
},table=>[index('jobs_expires_idx').on(table.expires)]);
export const counters = sqliteTable('counters', {
  id: text('id').primaryKey(), used: integer('used').notNull(), expires: integer('expires').notNull(),
},table=>[index('counters_expires_idx').on(table.expires)]);
export const lookups = sqliteTable('lookups', {
  id: text('id').primaryKey(), data: text('data').notNull(), expires: integer('expires').notNull(),
},table=>[index('lookups_expires_idx').on(table.expires)]);
