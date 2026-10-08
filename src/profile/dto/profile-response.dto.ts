import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordResponseDto {
  @ApiProperty({
    example: 'Password updated. Please log in again on all devices.',
  })
  message: string;

  @ApiProperty({
    example: 2,
    description: 'Number of sessions that were ended',
  })
  sessions: number;
}
