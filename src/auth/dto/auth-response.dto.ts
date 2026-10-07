import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateTime,
  ApiStringNullable,
} from '../../common/swagger/api-properties';

export class UserPublicResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 'perseus@example.com' })
  email: string;

  @ApiStringNullable('Perseus Studio')
  businessName: string | null;

  @ApiDateTime()
  createdAt: string;
}

/** Ringkasan user yang dikembalikan saat login (tanpa createdAt). */
export class AuthUserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 'perseus@example.com' })
  email: string;

  @ApiStringNullable('Perseus Studio')
  businessName: string | null;
}

export class AuthTokensResponseDto {
  @ApiProperty({ description: 'Short-lived JWT for Authorization header' })
  accessToken: string;

  @ApiProperty({ description: 'Random token to request a new token pair' })
  refreshToken: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({
    example: 900,
    description: 'Access token validity period in seconds',
  })
  expiresIn: number;
}

export class LoginResponseDto extends AuthTokensResponseDto {
  @ApiProperty({ type: () => AuthUserResponseDto })
  user: AuthUserResponseDto;
}

export class LogoutAllResponseDto {
  @ApiProperty({ example: 'All sessions have been successfully terminated' })
  message: string;

  @ApiProperty({ example: 2, description: 'Number of sessions terminated' })
  sessions: number;
}
