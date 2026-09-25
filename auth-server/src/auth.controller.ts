import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { AuthService } from "./auth.service.js";

const SESSION_COOKIE = "mc_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("health")
  async health() {
    return this.auth.health();
  }

  @Post("auth/send-code")
  @HttpCode(200)
  async sendCode(
    @Body() body: { email?: unknown; purpose?: unknown; password?: unknown },
  ) {
    return this.auth.sendCode(body);
  }

  @Post("auth/verify-code")
  @HttpCode(200)
  async verifyCode(
    @Body() body: { email?: unknown; code?: unknown; purpose?: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.verifyCode(body);
    this.setSessionCookie(response, session.token);
    return { user: session.user };
  }

  @Post("auth/password-login")
  @HttpCode(200)
  async passwordLogin(
    @Body() body: { email?: unknown; password?: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.passwordLogin(body);
    this.setSessionCookie(response, session.token);
    return { user: session.user };
  }

  @Get("auth/session")
  async session(@Req() request: Request) {
    return this.auth.getSession(request.cookies?.[SESSION_COOKIE]);
  }

  @Post("auth/logout")
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logout(request.cookies?.[SESSION_COOKIE]);
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return result;
  }

  private setSessionCookie(response: Response, token: string) {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_MS,
    });
  }
}
