import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import Dysmsapi20170525, {
  SendSmsRequest,
} from "@alicloud/dysmsapi20170525";
import { Config } from "@alicloud/openapi-client";

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: Dysmsapi20170525 | null;
  private readonly signName: string;
  private readonly templateCode: string;

  constructor() {
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim();
    const accessKeySecret =
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim();
    this.signName = process.env.ALIBABA_CLOUD_SMS_SIGN_NAME?.trim() || "";
    this.templateCode =
      process.env.ALIBABA_CLOUD_SMS_TEMPLATE_CODE?.trim() || "";

    this.client =
      accessKeyId && accessKeySecret && this.signName && this.templateCode
        ? new Dysmsapi20170525(
            new Config({
              accessKeyId,
              accessKeySecret,
              endpoint: "dysmsapi.aliyuncs.com",
            }),
          )
        : null;

    if (!this.client) {
      this.logger.warn(
        "尚未完整配置阿里云短信参数；手机验证码暂时无法发送。",
      );
    }
  }

  isConfigured() {
    return Boolean(this.client);
  }

  async sendVerificationCode(phone: string, code: string) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        "手机短信服务尚未配置，请先配置阿里云短信参数。",
      );
    }

    try {
      const response = await this.client.sendSms(
        new SendSmsRequest({
          phoneNumbers: phone,
          signName: this.signName,
          templateCode: this.templateCode,
          templateParam: JSON.stringify({ code }),
        }),
      );
      const result = response.body;
      if (result?.code !== "OK") {
        this.logger.error(
          `阿里云短信发送失败：${result?.code || "UNKNOWN"} ${result?.message || ""}`,
        );
        throw new ServiceUnavailableException(
          `手机验证码发送失败：${result?.message || result?.code || "短信服务异常"}`,
        );
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const smsError = error as { code?: string; message?: string };
      this.logger.error(
        `阿里云短信请求失败：${smsError.code || "UNKNOWN"} ${smsError.message || ""}`,
      );
      throw new ServiceUnavailableException(
        "手机验证码发送失败，请检查阿里云短信配置后重试。",
      );
    }
  }
}
