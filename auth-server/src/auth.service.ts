import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { DatabaseService } from "./database.service.js";
import { MailerService } from "./mailer.service.js";

const scrypt = promisify(scryptCallback);
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 30;

type CodePurpose = "login" | "signup";
type UserRow = { id: string; email: string; password_hash: string | null };
type CodeRow = {
  id: string;
  code_hash: string;
  pending_password_hash: string | null;
  attempts: number;
  expires_at: Date;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MailerService) private readonly mailer: MailerService,
  ) {}

  private normalizeEmail(value: unknown) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new BadRequestException("请输入有效的邮箱地址。");
    }
    return email;
  }

  private getOtpSecret() {
    const secret = process.env.OTP_HASH_SECRET?.trim();
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException("验证码安全密钥尚未配置。");
    }
    return secret;
  }

  private hashCode(email: string, purpose: CodePurpose, code: string) {
    return createHmac("sha256", this.getOtpSecret())
      .update(`${email}:${purpose}:${code}`)
      .digest("hex");
  }

  private hashSessionToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async hashPassword(password: string) {
    if (password.length < 8 || password.length > 128) {
      throw new BadRequestException("密码需要为 8–128 位。");
    }
    const salt = randomBytes(16).toString("hex");
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt$${salt}$${derived.toString("hex")}`;
  }

  private async verifyPassword(password: string, encoded: string) {
    const [algorithm, salt, expectedHex] = encoded.split("$");
    if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
    const actual = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async sendCode(input: {
    email?: unknown;
    purpose?: unknown;
    password?: unknown;
  }) {
    const email = this.normalizeEmail(input.email);
    const purpose: CodePurpose = input.purpose === "signup" ? "signup" : "login";
    let pendingPasswordHash: string | null = null;

    if (purpose === "signup") {
      const password = typeof input.password === "string" ? input.password : "";
      pendingPasswordHash = await this.hashPassword(password);
      const existing = await this.database.query<UserRow>(
        "SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1",
        [email],
      );
      if (existing.rows[0]?.password_hash) {
        throw new ConflictException("这个邮箱已经注册，可以直接登录。");
      }
    }

    const rate = await this.database.query<{
      latest_created_at: Date | null;
      hourly_count: string;
    }>(
      `SELECT
         MAX(created_at) AS latest_created_at,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS hourly_count
       FROM email_verification_codes
       WHERE email = $1`,
      [email],
    );
    const latest = rate.rows[0]?.latest_created_at;
    if (latest && Date.now() - new Date(latest).getTime() < OTP_RESEND_SECONDS * 1000) {
      throw new HttpException(
        "请等待 60 秒后再重新发送。",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (Number(rate.rows[0]?.hourly_count ?? 0) >= OTP_MAX_PER_HOUR) {
      throw new HttpException(
        "验证码发送过于频繁，请一小时后再试。",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(100000, 1000000));
    const id = randomUUID();
    await this.database.query(
      `INSERT INTO email_verification_codes
        (id, email, purpose, code_hash, pending_password_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${OTP_TTL_MINUTES} minutes')`,
      [id, email, purpose, this.hashCode(email, purpose, code), pendingPasswordHash],
    );

    try {
      await this.mailer.sendVerificationCode(email, code);
    } catch (error) {
      await this.database.query(
        "DELETE FROM email_verification_codes WHERE id = $1",
        [id],
      );
      throw error;
    }

    return { ok: true, expiresInSeconds: OTP_TTL_MINUTES * 60 };
  }

  async verifyCode(input: { email?: unknown; code?: unknown; purpose?: unknown }) {
    const email = this.normalizeEmail(input.email);
    const purpose: CodePurpose = input.purpose === "signup" ? "signup" : "login";
    const code = typeof input.code === "string" ? input.code.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException("请输入 6 位数字验证码。");
    }

    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<CodeRow>(
        `SELECT id, code_hash, pending_password_hash, attempts, expires_at
         FROM email_verification_codes
         WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [email, purpose],
      );
      const record = result.rows[0];
      if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
        throw new BadRequestException("验证码无效或已经过期，请重新获取。");
      }
      if (record.attempts >= OTP_MAX_ATTEMPTS) {
        throw new HttpException(
          "验证码尝试次数过多，请重新获取。",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const actual = Buffer.from(this.hashCode(email, purpose, code), "hex");
      const expected = Buffer.from(record.code_hash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await client.query(
          "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1",
          [record.id],
        );
        await client.query("COMMIT");
        throw new BadRequestException("验证码不正确，请重新输入。");
      }

      await client.query(
        "UPDATE email_verification_codes SET consumed_at = NOW() WHERE id = $1",
        [record.id],
      );
      const existing = await client.query<UserRow>(
        "SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1 FOR UPDATE",
        [email],
      );
      let user = existing.rows[0];
      if (!user) {
        const created = await client.query<UserRow>(
          `INSERT INTO users (id, email, password_hash, email_verified_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, email, password_hash`,
          [randomUUID(), email, record.pending_password_hash],
        );
        user = created.rows[0];
      } else if (purpose === "signup" && record.pending_password_hash) {
        const updated = await client.query<UserRow>(
          `UPDATE users SET password_hash = $1, email_verified_at = NOW(), updated_at = NOW()
           WHERE id = $2 RETURNING id, email, password_hash`,
          [record.pending_password_hash, user.id],
        );
        user = updated.rows[0];
      }

      const session = await this.createSession(client, user);
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async passwordLogin(input: { email?: unknown; password?: unknown }) {
    const email = this.normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    const result = await this.database.query<UserRow>(
      "SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    const user = result.rows[0];
    if (!user?.password_hash || !(await this.verifyPassword(password, user.password_hash))) {
      throw new UnauthorizedException("邮箱或密码不正确。");
    }

    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const session = await this.createSession(client, user);
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async createSession(
    client: Awaited<ReturnType<DatabaseService["connect"]>>,
    user: UserRow,
  ) {
    const token = randomBytes(32).toString("base64url");
    await client.query(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${SESSION_TTL_DAYS} days')`,
      [this.hashSessionToken(token), user.id],
    );
    await client.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");
    return { token, user: { id: user.id, email: user.email } };
  }

  async getSession(token: string | undefined) {
    if (!token) throw new UnauthorizedException("尚未登录。");
    const result = await this.database.query<{ id: string; email: string }>(
      `SELECT users.id, users.email
       FROM auth_sessions
       JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = $1 AND auth_sessions.expires_at > NOW()
       LIMIT 1`,
      [this.hashSessionToken(token)],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException("登录状态已过期。");
    return { user };
  }

  async logout(token: string | undefined) {
    if (token) {
      await this.database.query(
        "DELETE FROM auth_sessions WHERE token_hash = $1",
        [this.hashSessionToken(token)],
      );
    }
    return { ok: true };
  }

  async health() {
    const database = await this.database.isHealthy();
    const mail = await this.mailer.isHealthy();
    return {
      ok: database && mail,
      database,
      mail,
    };
  }
}
