import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ActionsModule } from './actions/actions.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Đọc biến môi trường từ file .env
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Cho phép thực hiện các request HTTP
    HttpModule,
    ActionsModule,
    AuthModule,
  ],
})
export class AppModule {}
