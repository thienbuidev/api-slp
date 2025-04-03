import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private accessToken: string = null;
  private tokenExpiration = 0; // timestamp (ms)

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Lấy access token. Nếu token chưa tồn tại hoặc hết hạn, tiến hành đăng nhập lại.
   */
  async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiration) {
      await this.login();
    }
    return this.accessToken;
  }

  /**
   * Đăng nhập vào ThingsBoard để lấy access token.
   * Sau khi nhận được token, decode JWT để lấy trường exp (expiration)
   */
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
      // Lưu token
      this.accessToken = response.data.token;

      // Decode token để lấy thời gian hết hạn (exp tính theo giây, chuyển sang ms)
      const decoded: any = jwt.decode(this.accessToken);
      if (!decoded || !decoded.exp) {
        // Nếu không có thông tin exp thì mặc định 5 phút
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
