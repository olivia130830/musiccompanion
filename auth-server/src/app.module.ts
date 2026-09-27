import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { MailerService } from "./mailer.service.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, DatabaseService, MailerService],
})
export class AppModule {}

