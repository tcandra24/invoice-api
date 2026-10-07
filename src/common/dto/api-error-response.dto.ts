import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success: false;

  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    description:
      'A single text string or a list of messages for validation errors',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['name should not be empty'],
  })
  message: string | string[];

  @ApiProperty({ example: '/clients' })
  path: string;

  @ApiProperty({ example: '2026-10-07T03:00:00.000Z' })
  timestamp: string;
}
