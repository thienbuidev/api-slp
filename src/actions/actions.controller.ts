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
  async processAction(@Body() body: { assetId: string; statusLight: string }) {
    try {
      await this.actionsService.processAction(body.assetId, body.statusLight);
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
    @Body() body: { assetId: string; params: ScheduleParams },
  ) {
    try {
      await this.actionsService.processSchedule(body.assetId, body.params);
      return { message: 'Schedule processed successfully' };
    } catch (error) {
      throw new HttpException(
        { error: 'Internal server error', details: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
