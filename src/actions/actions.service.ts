import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);
  private readonly thingsboardUrl: string;
  private readonly chirpstackUrl: string;
  private readonly chirpstackToken: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.thingsboardUrl = this.configService.get<string>('THINGSBOARD_URL');
    this.chirpstackUrl = this.configService.get<string>('CHIRPSTACK_URL');
    this.chirpstackToken = this.configService.get<string>(
      'ACCESS_TOKEN_CHIRPSTACK',
    );
  }

  async processAction(assetId: string, statusLight: string): Promise<void> {
    // Lấy ThingsBoard token (sẽ tự động kiểm tra hiệu lực và đăng nhập nếu cần)
    const thingsboardToken = await this.authService.getAccessToken();

    // Gọi API ThingsBoard: POST /api/relations
    const relationsUrl = `${this.thingsboardUrl}/api/relations`;
    const relationsPayload = {
      parameters: {
        rootId: assetId,
        rootType: 'DEVICE',
        direction: 'FROM',
        relationTypeGroup: 'COMMON',
        maxLevel: 1073741824,
        fetchLastLevelOnly: true,
      },
      filters: [
        {
          relationType: 'Contains',
          entityTypes: ['DEVICE'],
          negate: true,
        },
      ],
    };

    const relationsResponse = await firstValueFrom(
      this.httpService.post(relationsUrl, relationsPayload, {
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Authorization': `Bearer ${thingsboardToken}`,
        },
      }),
    );

    const deviceIds = relationsResponse.data
      .filter((item) => item.to.entityType === 'DEVICE')
      .map((item) => item.to.id);

    this.logger.log(`Device IDs: ${deviceIds}`);

    // Với mỗi device, lấy telemetry và attributes từ ThingsBoard rồi gửi lên ChirpStack
    for (const deviceId of deviceIds) {
      const telemetryUrl = `${this.thingsboardUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=data_UID`;
      const attributesUrl = `${this.thingsboardUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes?keys=dev_eui`;

      const [telemetryRes, attributesRes] = await Promise.all([
        firstValueFrom(
          this.httpService.get(telemetryUrl, {
            headers: {
              accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Authorization': `Bearer ${thingsboardToken}`,
            },
          }),
        ),
        firstValueFrom(
          this.httpService.get(attributesUrl, {
            headers: {
              accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Authorization': `Bearer ${thingsboardToken}`,
            },
          }),
        ),
      ]);

      const telemetryData = telemetryRes.data.data_UID?.[0];
      if (!telemetryData) {
        this.logger.error(`No telemetry data for device ${deviceId}`);
        continue;
      }
      const dataUid = telemetryData.value;

      const attributesData = attributesRes.data?.[0];
      if (!attributesData) {
        this.logger.error(`No attributes data for device ${deviceId}`);
        continue;
      }
      const devEui = attributesData.value;

      // Tạo hex string và chuyển đổi sang base64
      const hexString = this.encodeHexString(dataUid, statusLight);
      const base64String = this.decodeHexToBase64(hexString);

      // Đợi 6 giây trước khi gọi API ChirpStack (có thể dùng để đồng bộ nếu cần)
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Gọi API ChirpStack để gửi queue
      const chirpstackUrl = `${this.chirpstackUrl}/api/devices/${devEui}/queue`;
      const chirpstackPayload = {
        queueItem: {
          confirmed: false,
          data: base64String,
          fPort: 10,
        },
      };

      const chirpstackRes = await firstValueFrom(
        this.httpService.post(chirpstackUrl, chirpstackPayload, {
          headers: {
            'Content-Type': 'application/json',
            'Grpc-Metadata-Authorization': `Bearer ${this.chirpstackToken}`,
          },
        }),
      );
      this.logger.log(
        `ChirpStack response for device ${devEui}: ${JSON.stringify(
          chirpstackRes.data,
        )}`,
      );
    }
  }

  private encodeHexString(data_UID: string, status_Light: string): string {
    const fixedValues = '680106F0002001';
    const uidHex = data_UID.toUpperCase();
    let actionHex: string;
    let dimmingLevel: string;
    if (status_Light === 'Light On') {
      actionHex = '21';
      dimmingLevel = '64';
    } else if (status_Light === 'Light Off') {
      actionHex = '22';
      dimmingLevel = '00';
    } else {
      throw new Error('Invalid light action');
    }
    const hexStringWithoutChecksum = `68${uidHex}${fixedValues}${actionHex}${dimmingLevel}`;
    const bytes = hexStringWithoutChecksum.match(/.{1,2}/g);
    const sum = bytes.reduce((acc, hex) => acc + parseInt(hex, 16), 0);
    const checksumHex = sum
      .toString(16)
      .toUpperCase()
      .slice(-2)
      .padStart(2, '0');
    return `${hexStringWithoutChecksum}${checksumHex}16`;
  }

  private decodeHexToBase64(hexString: string): string {
    return Buffer.from(hexString, 'hex').toString('base64');
  }
}
