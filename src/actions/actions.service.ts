import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { ScheduleParams } from './actions.interface';

interface DeviceData {
  deviceId: string;
  dataUid: string;
  devEui: string;
}

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

  async processAction(
    assetId: string,
    statusLight: string,
    relatedEntityName: string,
  ): Promise<void> {
    try {
      const thingsboardToken = await this.authService.getAccessToken();
      const deviceData = await this.fetchDeviceData(assetId, thingsboardToken);

      await this.processDevices(deviceData, async (device) => {
        const hexString = this.encodeHexTurnLight(device.dataUid, statusLight);
        const base64String = this.decodeHexToBase64(hexString);

        return this.sendChirpstackCommand(device.devEui, base64String);
      });

      // Trigger notification after processing all devices
      await this.processNotification(assetId, relatedEntityName);
      this.logger.log(
        `Action completed for asset ${assetId} with status ${statusLight}`,
      );
    } catch (error) {
      this.logger.error(`Error processing action: ${error.message}`);
      throw error;
    }
  }

  async processTimeSync(assetId: string, timeNow: string): Promise<void> {
    try {
      const thingsboardToken = await this.authService.getAccessToken();
      const deviceData = await this.fetchDeviceData(assetId, thingsboardToken);

      await this.processDevices(deviceData, async (device) => {
        const hexString = this.encodeHexTimeSync(device.dataUid, timeNow);
        const base64String = this.decodeHexToBase64(hexString);

        return this.sendChirpstackCommand(device.devEui, base64String);
      });

      this.logger.log(`Time sync completed for asset ${assetId}`);
    } catch (error) {
      this.logger.error(`Error processing time sync: ${error.message}`);
      throw error;
    }
  }

  async processSchedule(
    assetId: string,
    scheduleParams: ScheduleParams,
    relatedEntityName: string,
  ): Promise<void> {
    try {
      const thingsboardToken = await this.authService.getAccessToken();
      const deviceData = await this.fetchDeviceData(assetId, thingsboardToken);

      await this.processDevices(deviceData, async (device) => {
        const hexString = this.encodeHexSchedule(
          device.dataUid,
          scheduleParams,
        );
        const base64String = this.decodeHexToBase64(hexString);

        this.logger.log(`Schedule Hex: ${hexString}`);
        this.logger.log(`Schedule Base64: ${base64String}`);

        return this.sendChirpstackCommand(device.devEui, base64String);
      });

      // Trigger notification after processing all devices
      await this.sendScheduleNotification(
        deviceData.length,
        relatedEntityName,
        thingsboardToken,
      );
      this.logger.log(`Schedule completed for asset ${assetId}`);
    } catch (error) {
      this.logger.error(`Error processing schedule: ${error.message}`);
      throw error;
    }
  }

  async processNotification(
    assetId: string,
    relatedEntityName: string,
  ): Promise<void> {
    try {
      const thingsboardToken = await this.authService.getAccessToken();
      const deviceIds = await this.getChildDeviceIds(assetId, thingsboardToken);

      // Count devices status
      let onCount = 0;
      let offCount = 0;

      for (const deviceId of deviceIds) {
        const dimlevelUrl = `${this.thingsboardUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=data_dim_level`;

        try {
          const dimlevelRes = await firstValueFrom(
            this.httpService.get(dimlevelUrl, {
              headers: this.getThingsboardHeaders(thingsboardToken),
            }),
          );

          const dimlevelData = dimlevelRes.data.data_dim_level?.[0];
          if (!dimlevelData) {
            this.logger.warn(`No dim level data for device ${deviceId}`);
            continue;
          }

          const dimLevel = dimlevelData.value;
          if (dimLevel > 0) {
            onCount++;
          } else {
            offCount++;
          }
          console.log(
            `Device ${deviceId} dim level: ${dimLevel}, onCount: ${onCount}, offCount: ${offCount}`,
          );
        } catch (error) {
          this.logger.error(
            `Error fetching dim level for device ${deviceId}: ${error.message}`,
          );
        }
      }

      // Get notification targets
      const targetsUrl = `${this.thingsboardUrl}/api/notification/targets?pageSize=100&page=0`;
      const targetsRes = await firstValueFrom(
        this.httpService.get(targetsUrl, {
          headers: this.getThingsboardHeaders(thingsboardToken),
        }),
      );

      const targets = targetsRes.data.data;
      if (!targets || targets.length === 0) {
        throw new Error('No notification targets found');
      }

      // Find a suitable target (looking for PLATFORM_USERS type targets)
      const suitableTarget = targets.find(
        (target) =>
          target.name === 'Bộ phận quản lý phường' &&
          target.configuration.type === 'PLATFORM_USERS',
      );

      if (!suitableTarget) {
        throw new Error('No suitable notification target found');
      }

      const targetId = suitableTarget.id.id;
      console.log(`Target ID: ${targetId}`);
      const totalDevices = deviceIds.length;

      // Send notification
      const notificationUrl = `${this.thingsboardUrl}/api/notification/request`;
      const notificationRequest = {
        targets: [targetId],
        template: {
          name: 'Device Status Report',
          notificationType: 'GENERAL',
          configuration: {
            deliveryMethodsTemplates: {
              WEB: {
                enabled: true,
                method: 'WEB',
                subject: `Thông báo tín hiệu cụm thiết bị`,
                body: `${relatedEntityName} hiện đang bật ${onCount}/${totalDevices} thiết bị.`,
              },
            },
          },
        },
        additionalConfig: {
          sendingDelayInSec: 0,
        },
      };

      const response = await firstValueFrom(
        this.httpService.post(notificationUrl, notificationRequest, {
          headers: this.getThingsboardHeaders(thingsboardToken),
        }),
      );

      this.logger.log(
        `Đã gửi thông báo thành công. RequestId: ${response.data.id?.id}`,
      );
    } catch (error) {
      this.logger.error(`Lỗi khi gửi thông báo: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response: ${JSON.stringify(error.response.data)}`);
      }
    }
  }

  private async sendScheduleNotification(
    deviceCount: number,
    relatedEntityName: string,
    thingsboardToken: string,
  ): Promise<void> {
    try {
      // Get notification targets
      const targetsUrl = `${this.thingsboardUrl}/api/notification/targets?pageSize=100&page=0`;
      const targetsRes = await firstValueFrom(
        this.httpService.get(targetsUrl, {
          headers: this.getThingsboardHeaders(thingsboardToken),
        }),
      );

      const targets = targetsRes.data.data;
      if (!targets || targets.length === 0) {
        throw new Error('No notification targets found');
      }

      // Find a suitable target (looking for PLATFORM_USERS type targets)
      const suitableTarget = targets.find(
        (target) =>
          target.name === 'Bộ phận quản lý phường' &&
          target.configuration.type === 'PLATFORM_USERS',
      );

      if (!suitableTarget) {
        throw new Error('No suitable notification target found');
      }

      const targetId = suitableTarget.id.id;
      // const totalDevices = deviceIds.length;

      // Send notification
      const notificationUrl = `${this.thingsboardUrl}/api/notification/request`;
      const notificationRequest = {
        targets: [targetId],
        template: {
          name: 'Schedule Success Report',
          notificationType: 'GENERAL',
          configuration: {
            deliveryMethodsTemplates: {
              WEB: {
                enabled: true,
                method: 'WEB',
                subject: `Thông báo thiết lập cụm thiết bị`,
                body: `Lập lịch thành công cho ${deviceCount}/${deviceCount} thiết bị trên ${relatedEntityName}`,
              },
            },
          },
        },
        additionalConfig: {
          sendingDelayInSec: 0,
        },
      };

      const response = await firstValueFrom(
        this.httpService.post(notificationUrl, notificationRequest, {
          headers: this.getThingsboardHeaders(thingsboardToken),
        }),
      );

      this.logger.log(
        `Đã gửi thông báo lập lịch thành công. RequestId: ${response.data.id?.id}`,
      );
    } catch (error) {
      this.logger.error(`Lỗi khi gửi thông báo lập lịch: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response: ${JSON.stringify(error.response.data)}`);
      }
    }
  }

  private async fetchDeviceData(
    assetId: string,
    thingsboardToken: string,
  ): Promise<DeviceData[]> {
    const deviceIds = await this.getChildDeviceIds(assetId, thingsboardToken);
    this.logger.log(`Device IDs: ${deviceIds}`);
    const deviceDataPromises = deviceIds.map(async (deviceId) => {
      try {
        const telemetryUrl = `${this.thingsboardUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=data_UID`;
        const attributesUrl = `${this.thingsboardUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes?keys=dev_eui`;
        const [telemetryRes, attributesRes] = await Promise.all([
          firstValueFrom(
            this.httpService.get(telemetryUrl, {
              headers: this.getThingsboardHeaders(thingsboardToken),
            }),
          ),
          firstValueFrom(
            this.httpService.get(attributesUrl, {
              headers: this.getThingsboardHeaders(thingsboardToken),
            }),
          ),
        ]);

        const telemetryData = telemetryRes.data.data_UID?.[0];
        if (!telemetryData) {
          throw new Error(`No telemetry data for device ${deviceId}`);
        }
        let dataUid = telemetryData.value;

        if (dataUid.length !== 12) {
          this.logger.log(
            `Data UID length is not 12 for device ${deviceId}, padding with zeros`,
          );
          dataUid = dataUid.padStart(12, '0');
        }

        const attributesData = attributesRes.data?.[0];
        if (!attributesData) {
          throw new Error(`No attributes data for device ${deviceId}`);
        }
        const devEui = attributesData.value;
        this.logger.log(
          `Device ID: ${deviceId}, Data UID: ${dataUid}, Data UID: ${typeof dataUid}, Dev EUI: ${devEui}`,
        );
        return { deviceId, dataUid, devEui };
      } catch (error) {
        this.logger.error(
          `Failed to fetch data for device ${deviceId}: ${error.message}`,
        );
        return null;
      }
    });
    const results = await Promise.all(deviceDataPromises);
    return results.filter(Boolean) as DeviceData[];
  }

  private async processDevices(
    devices: DeviceData[],
    processFunction: (device: DeviceData) => Promise<any>,
    delayBetweenRequests: number = 6000,
  ): Promise<void> {
    this.logger.log('=======> PROCESS DEVICES CALL <=======');
    for (const device of devices) {
      try {
        await processFunction(device);

        // Apply delay between device processing
        if (delayBetweenRequests > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenRequests),
          );
        }
      } catch (error) {
        this.logger.error(
          `Error processing device ${device.deviceId}: ${error.message}`,
        );
      }
    }
  }

  private async sendChirpstackCommand(
    devEui: string,
    base64Data: string,
    fPort: number = 10,
  ): Promise<any> {
    const chirpstackUrl = `${this.chirpstackUrl}/api/devices/${devEui}/queue`;
    const chirpstackPayload = {
      queueItem: {
        confirmed: false,
        data: base64Data,
        fPort,
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

    return chirpstackRes.data;
  }

  private getThingsboardHeaders(token: string): Record<string, string> {
    return {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Authorization': `Bearer ${token}`,
    };
  }

  private async getChildDeviceIds(
    assetId: string,
    token: string,
  ): Promise<string[]> {
    const relationsUrl = `${this.thingsboardUrl}/api/relations`;
    const relationPayload = {
      parameters: {
        rootId: assetId,
        rootType: 'DEVICE',
        direction: 'FROM',
        relationTypeGroup: 'COMMON',
        maxLevel: 1073741824,
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
      this.httpService.post(relationsUrl, relationPayload, {
        headers: this.getThingsboardHeaders(token),
      }),
    );

    const deviceIds = relationsResponse.data
      .filter((item) => item.to.entityType === 'DEVICE')
      .map((item) => item.to.id);

    this.logger.log(`Found ${deviceIds.length} child devices`);
    return deviceIds;
  }

  // Encoding methods
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

  private encodeHexTimeSync(data_UID: string, time_Now: string): string {
    const fixedValues = ['68', '01', '0B', 'F0', '00', '2D'];
    const uid = data_UID.toUpperCase();
    const uidHexArray = uid.match(/.{1,2}/g)?.map((byte) => byte.toUpperCase());
    if (!uidHexArray || uidHexArray.length === 0) {
      throw new Error('Invalid UID format.');
    }
    const uidHex = uidHexArray.join('');

    const parts = time_Now.split(' ');
    if (parts.length < 3) {
      throw new Error('Invalid time_Now format.');
    }

    const [weekday, dateStr, timeStr] = parts;
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute, second] = timeStr.split(':').map(Number);

    const daysOfWeek: Record<string, number> = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6,
    };

    const toHex = (value: number) =>
      value.toString(16).padStart(2, '0').toUpperCase();

    const hexTimeNow =
      toHex(hour) +
      toHex(minute) +
      toHex(second) +
      toHex(Math.floor(year / 100)) +
      toHex(year % 100) +
      toHex(month) +
      toHex(day) +
      toHex(daysOfWeek[weekday]);

    const fullHexString = '68' + uidHex + fixedValues.join('') + hexTimeNow;

    const byteArray = fullHexString
      .match(/.{1,2}/g)!
      .map((hex) => parseInt(hex, 16));
    const checksum = byteArray.reduce((acc, val) => acc + val, 0) % 256;
    const checksumHex = toHex(checksum);

    const finalHexString = fullHexString + checksumHex + '16';
    return finalHexString;
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
