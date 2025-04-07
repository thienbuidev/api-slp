import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { ScheduleParams } from './actions.interface';

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
    const thingsboardToken = await this.authService.getAccessToken();

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

      const hexString = this.encodeHexTurnLight(dataUid, statusLight);
      const base64String = this.decodeHexToBase64(hexString);

      await new Promise((resolve) => setTimeout(resolve, 6000));

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

  async processSchedule(
    assetId: string,
    scheduleParams: ScheduleParams,
  ): Promise<void> {
    const thingsboardToken = await this.authService.getAccessToken();

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

    this.logger.log(`Processing schedule for devices: ${deviceIds}`);

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

      const hexString = this.encodeHexSchedule(dataUid, scheduleParams);
      const base64String = this.decodeHexToBase64(hexString);

      this.logger.log(`Schedule Hex: ${hexString}`);
      this.logger.log(`Schedule Base64: ${base64String}`);

      await new Promise((resolve) => setTimeout(resolve, 6000));

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
        `ChirpStack schedule response for device ${devEui}: ${JSON.stringify(
          chirpstackRes.data,
        )}`,
      );
    }
  }

  private encodeHexTurnLight(data_UID: string, status_Light: string): string {
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

  private encodeHexSchedule(data_UID: string, params: ScheduleParams): string {
    if (!data_UID || typeof data_UID !== 'string') {
      throw new Error('Invalid UID format');
    }
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters format');
    }
    const fixedValues = '680111F0002C010100000002';
    const uidHex = '68' + data_UID.toUpperCase();

    const { setTime1, setTime2, dimming1, dimming2 } = params;
    if (
      !setTime1 ||
      !setTime2 ||
      dimming1 === undefined ||
      dimming2 === undefined
    ) {
      throw new Error('Missing required parameters in params');
    }
    const toHex = (value: number): string =>
      value.toString(16).padStart(2, '0').toUpperCase();
    const [hour1, minute1] = setTime1
      .split(`:`)
      .map((t) => toHex(parseInt(t, 10)));
    const [hour2, minute2] = setTime2
      .split(':')
      .map((t) => toHex(parseInt(t, 10)));
    const dimHex1 = toHex(dimming1);
    const dimHex2 = toHex(dimming2);

    const fullHexString = `${uidHex}${fixedValues}${hour1}${minute1}23${dimHex1}${hour2}${minute2}23${dimHex2}`;

    const bytes = fullHexString.match(/.{1,2}/g);
    const sum = bytes.reduce((acc, hex) => acc + parseInt(hex, 16), 0);
    const checksumHex = sum
      .toString(16)
      .toUpperCase()
      .slice(-2)
      .padStart(2, '0');

    const finalHexString = `${fullHexString}${checksumHex}16`;

    return finalHexString;
  }

  private decodeHexToBase64(hexString: string): string {
    return Buffer.from(hexString, 'hex').toString('base64');
  }
}
