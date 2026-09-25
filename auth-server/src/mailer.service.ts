import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter | null;
  private verifiedAt = 0;

  constructor() {
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();

    this.transporter =
      user && pass
        ? nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT || 465),
            secure: process.env.SMTP_SECURE !== "false",
            auth: { user, pass: pass.replace(/\s/g, "") },
          })
        : null;

    if (!this.transporter) {
      this.logger.warn(
        "尚未配置 SMTP_USER/SMTP_PASS；验证码邮件暂时无法发送。",
      );
    }
  }

  isConfigured() {
    return Boolean(this.transporter);
  }

  async isHealthy() {
    if (!this.transporter) return false;
    if (Date.now() - this.verifiedAt < 5 * 60 * 1000) return true;
    try {
      await this.transporter.verify();
      this.verifiedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  async sendVerificationCode(email: string, code: string) {
    if (!this.transporter) {
      throw new ServiceUnavailableException("邮件服务尚未配置。");
    }

    const from =
      process.env.SMTP_FROM?.trim() ||
      `MusicCompanion <${process.env.SMTP_USER}>`;

    try {
      await this.transporter.sendMail({
        from,
        to: email,
        subject: `${code} 是你的 MusicCompanion 验证码`,
        text: `你的 MusicCompanion 验证码是 ${code}。验证码将在 10 分钟后失效，请勿转发给他人。`,
        html: `
        <div style="font-family:Arial,'PingFang SC',sans-serif;max-width:520px;margin:auto;padding:32px;color:#182033">
          <p style="color:#5578ed;font-size:12px;letter-spacing:2px">MUSICCOMPANION</p>
          <h1 style="font-size:24px">登录验证码</h1>
          <p style="color:#657087;line-height:1.8">输入下面的 6 位数字，继续和 AI 一起听音乐。</p>
          <div style="margin:28px 0;padding:20px;border-radius:16px;background:#f2f5ff;color:#5578ed;font-size:34px;font-weight:700;letter-spacing:10px;text-align:center">${code}</div>
          <p style="color:#9099ab;font-size:12px">验证码将在 10 分钟后失效。如果不是你本人操作，可以忽略这封邮件。</p>
        </div>
      `,
      });
      this.verifiedAt = Date.now();
    } catch (error) {
      const smtpError = error as {
        code?: string;
        responseCode?: number;
      };
      if (smtpError.code === "EAUTH" || smtpError.responseCode === 535) {
        throw new ServiceUnavailableException(
          "Gmail SMTP 登录失败，请检查邮箱地址和 Google 应用专用密码。",
        );
      }
      throw new ServiceUnavailableException(
        "验证码邮件发送失败，请稍后重试。",
      );
    }
  }
}
