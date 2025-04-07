import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private accessToken: string = null;
  private tokenExpiration = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiration) {
      await this.login();
    }
    return this.accessToken;
  }

  private async login(): Promise<void> {
    const thingsboardUrl = this.configService.get<string>('THINGSBOARD_URL');
    const username = this.configService.get<string>('THINGSBOARD_USERNAME');
    const password = this.configService.get<string>('THINGSBOARD_PASSWORD');
    const loginUrl = `${thingsboardUrl}/api/auth/login`;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          loginUrl,
          { username, password },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      this.accessToken = response.data.token;

      const decoded: any = jwt.decode(this.accessToken);
      if (!decoded || !decoded.exp) {
        this.tokenExpiration = Date.now() + 300000;
      } else {
        this.tokenExpiration = decoded.exp * 1000;
      }

      this.logger.log('Successfully logged in to ThingsBoard');
    } catch (error) {
      this.logger.error('Error logging in to ThingsBoard:', error.message);
      throw new Error('Unable to authenticate with ThingsBoard');
    }
  }
}
