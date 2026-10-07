import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateTime,
  ApiStringNullable,
} from '../../common/swagger/api-properties';
import {
  ReminderChannel,
  ReminderStage,
  ReminderStatus,
} from '../../generated/prisma/client';

export class ReminderLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceId: string;

  @ApiProperty({ enum: ReminderStage, enumName: 'ReminderStage' })
  stage: ReminderStage;

  @ApiProperty({ enum: ReminderChannel, enumName: 'ReminderChannel' })
  channel: ReminderChannel;

  @ApiProperty({ enum: ReminderStatus, enumName: 'ReminderStatus' })
  status: ReminderStatus;

  @ApiProperty({ example: 'maju@example.com' })
  recipient: string;

  @ApiStringNullable()
  error: string | null;

  @ApiDateTime()
  sentAt: string;
}

export class RunRemindersResponseDto {
  @ApiProperty({ example: 1, description: 'Invoice yang ditandai OVERDUE' })
  markedOverdue: number;

  @ApiProperty({ example: 2 })
  sent: number;

  @ApiProperty({ example: 0 })
  failed: number;

  @ApiProperty({ example: 1 })
  skipped: number;
}
