import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool | null;
  private schemaReady: Promise<void> | null = null;

  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim();
    this.pool = connectionString
      ? new Pool({
          connectionString,
          ssl:
            process.env.DATABASE_SSL === "true"
              ? { rejectUnauthorized: false }
              : undefined,
          max: Number(process.env.DATABASE_POOL_SIZE || 10),
        })
      : null;

    if (!this.pool) {
      this.logger.warn(
        "尚未配置 DATABASE_URL；认证服务会启动，但账号功能不可用。",
      );
    }
  }

  private getPool() {
    if (!this.pool) {
      throw new ServiceUnavailableException("账号数据库尚未配置。");
    }
    return this.pool;
  }

  async ensureSchema() {
    if (!this.schemaReady) {
      this.schemaReady = this.getPool()
        .query(`
          CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            email_verified_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS email_verification_codes (
            id UUID PRIMARY KEY,
            email TEXT NOT NULL,
            purpose TEXT NOT NULL CHECK (purpose IN ('login', 'signup')),
            code_hash TEXT NOT NULL,
            pending_password_hash TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS email_verification_codes_lookup_idx
            ON email_verification_codes (email, purpose, created_at DESC);

          CREATE TABLE IF NOT EXISTS auth_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
            ON auth_sessions (user_id, expires_at DESC);
        `)
        .then(() => undefined)
        .catch((error) => {
          this.schemaReady = null;
          throw error;
        });
    }
    await this.schemaReady;
  }

  async query<Row extends QueryResultRow>(text: string, values: unknown[] = []) {
    await this.ensureSchema();
    return this.getPool().query<Row>(text, values);
  }

  async connect(): Promise<PoolClient> {
    await this.ensureSchema();
    return this.getPool().connect();
  }

  async isHealthy() {
    if (!this.pool) return false;
    try {
      await this.ensureSchema();
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}

