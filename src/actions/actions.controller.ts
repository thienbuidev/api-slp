import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Get,
} from '@nestjs/common';
import { ActionsService } from './actions.service';

@Controller()
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  @Get()
  getHello() {
    return 'Server is up and running!';
  }

  @Post('actions')
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
}
