import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RunRemindersDto } from './dto/run-reminders.dto';
import { RemindersService } from './reminders.service';

@ApiTags('reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Jalankan overdue + reminder secara manual untuk invoice milik user (asOf hanya non-production)',
  })
  run(@CurrentUser('id') userId: string, @Query() query: RunRemindersDto) {
    if (query.asOf && process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'Simulasi tanggal (asOf) tidak tersedia di production',
      );
    }
    return this.remindersService.run(
      this.remindersService.parseAsOf(query.asOf),
      userId,
    );
  }

  @Get('invoice/:invoiceId')
  @ApiOperation({ summary: 'Riwayat pengiriman email untuk sebuah invoice' })
  findLogs(
    @CurrentUser('id') userId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.remindersService.findLogs(userId, invoiceId);
  }
}
