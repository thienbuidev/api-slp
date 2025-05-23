import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Get,
} from '@nestjs/common';
import { ActionsService } from './actions.service';
import { ScheduleParams } from './actions.interface';

@Controller('actions')
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  @Get()
  getHello() {
    return 'Server is up and running!';
  }

  @Post('/turnlight')
  async processAction(
    @Body()
    body: {
      assetId: string;
      statusLight: string;
      relatedEntityName: string;
    },
  ) {
    try {
      await this.actionsService.processAction(
        body.assetId,
        body.statusLight,
        body.relatedEntityName,
      );
      return { message: 'Received successfully' };
    } catch (error) {
      throw new HttpException(
        { error: 'Internal server error', details: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/timesync')
  async processTimeSync(@Body() body: { assetId: string; timeNow: string }) {
    try {
      await this.actionsService.processTimeSync(body.assetId, body.timeNow);
      return { message: 'Received successfully' };
    } catch (error) {
      throw new HttpException(
        { error: 'Internal server error', details: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/schedule')
  async processSchedule(
    @Body()
    body: {
      assetId: string;
      params: ScheduleParams;
      relatedEntityName: string;
    },
  ) {
    try {
      await this.actionsService.processSchedule(
        body.assetId,
        body.params,
        body.relatedEntityName,
      );
      return { message: 'Schedule processed successfully' };
    } catch (error) {
      throw new HttpException(
        { error: 'Internal server error', details: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/notification')
  async processNotification(
    @Body() body: { assetId: string; relatedEntityName: string },
  ) {
    try {
      await this.actionsService.processNotification(
        body.assetId,
        body.relatedEntityName,
      );
      return { message: 'Notification processed successfully' };
    } catch (error) {
      throw new HttpException(
        { error: 'Internal server error', details: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
