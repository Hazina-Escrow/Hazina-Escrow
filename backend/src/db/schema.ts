import { sql } from 'drizzle-orm';
import { pgTable, text, integer, numeric, boolean, index } from 'drizzle-orm/pg-core';
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  index as sqliteIndex,
} from 'drizzle-orm/sqlite-core';

// ── PostgreSQL tables ────────────────────────────────────────────────────────

export const datasets = pgTable(
  'datasets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type').notNull(),
    pricePerQuery: numeric('price_per_query').notNull(),
    sellerWallet: text('seller_wallet').notNull(),
    data: text('data').notNull().default('{}'),
    queriesServed: integer('queries_served').notNull().default(0),
    totalEarned: numeric('total_earned').notNull().default('0'),
    createdAt: text('created_at').notNull(),
  },
  table => ({
    typeIdx: index('datasets_type_idx').on(table.type),
    sellerWalletIdx: index('datasets_seller_wallet_idx').on(table.sellerWallet),
    createdAtIdx: index('datasets_created_at_idx').on(table.createdAt),
  }),
);

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull(),
  txHash: text('tx_hash').notNull().unique(),
  amount: numeric('amount').notNull(),
  buyerQuery: text('buyer_query'),
  aiSummary: text('ai_summary'),
  timestamp: text('timestamp').notNull(),
});

export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(),
  sellerWallet: text('seller_wallet').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events')
    .array()
    .notNull()
    .default(sql`'{}'`),
  active: boolean('active').notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// ── SQLite tables (used when DATABASE_URL is not postgres) ───────────────────

export const datasetsSqlite = sqliteTable(
  'datasets',
  {
    id: sqliteText('id').primaryKey(),
    name: sqliteText('name').notNull(),
    description: sqliteText('description').notNull(),
    type: sqliteText('type').notNull(),
    pricePerQuery: sqliteText('price_per_query').notNull(),
    sellerWallet: sqliteText('seller_wallet').notNull(),
    data: sqliteText('data').notNull().default('{}'),
    queriesServed: sqliteInteger('queries_served').notNull().default(0),
    totalEarned: sqliteText('total_earned').notNull().default('0'),
    createdAt: sqliteText('created_at').notNull(),
  },
  table => ({
    typeIdx: sqliteIndex('datasets_type_idx').on(table.type),
    sellerWalletIdx: sqliteIndex('datasets_seller_wallet_idx').on(table.sellerWallet),
    createdAtIdx: sqliteIndex('datasets_created_at_idx').on(table.createdAt),
  }),
);

export const transactionsSqlite = sqliteTable('transactions', {
  id: sqliteText('id').primaryKey(),
  datasetId: sqliteText('dataset_id').notNull(),
  txHash: sqliteText('tx_hash').notNull().unique(),
  amount: sqliteText('amount').notNull(),
  buyerQuery: sqliteText('buyer_query'),
  aiSummary: sqliteText('ai_summary'),
  timestamp: sqliteText('timestamp').notNull(),
});

export const webhooksSqlite = sqliteTable('webhooks', {
  id: sqliteText('id').primaryKey(),
  sellerWallet: sqliteText('seller_wallet').notNull(),
  url: sqliteText('url').notNull(),
  secret: sqliteText('secret').notNull(),
  events: sqliteText('events').notNull().default('[]'),
  active: sqliteInteger('active').notNull().default(1),
  createdAt: sqliteText('created_at').notNull(),
});
