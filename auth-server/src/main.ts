import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";

import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("auth-api");
  app.use(cookieParser());

  const port = Number(process.env.AUTH_PORT || 4000);
  const host = process.env.AUTH_HOST || "127.0.0.1";
  await app.listen(port, host);
  Logger.log(
    `认证服务已启动：http://${host}:${port}/auth-api/health`,
    "Bootstrap",
  );
}

void bootstrap();
