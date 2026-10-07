import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import {
  ApiErrorResponses,
  ApiWrappedResponse,
} from '../common/swagger/api-responses';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  AuthTokensResponseDto,
  LoginResponseDto,
  LogoutAllResponseDto,
  UserPublicResponseDto,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a business owner account' })
  @ApiWrappedResponse(UserPublicResponseDto, {
    status: 201,
    description: 'Account successfully created',
  })
  @ApiErrorResponses(400, 409, 429)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @ApiOperation({
    summary: 'Login: returns access token (short-lived) and refresh token',
  })
  @ApiWrappedResponse(LoginResponseDto, { status: 201 })
  @ApiErrorResponses(400, 401, 429)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Publik karena access token biasanya sudah kedaluwarsa saat dipanggil.
  // Kredensialnya adalah refresh token di body.
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange refresh token with a new token pair (rotation)',
  })
  @ApiWrappedResponse(AuthTokensResponseDto)
  @ApiErrorResponses(400, 401, 429)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'End this session by revoking the refresh token' })
  @ApiWrappedResponse(MessageResponseDto)
  @ApiErrorResponses(400, 429)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke all user sessions on all devices' })
  @ApiWrappedResponse(LogoutAllResponseDto)
  @ApiErrorResponses(401, 429)
  logoutAll(@CurrentUser('id') userId: string) {
    return this.authService.logoutAll(userId);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get profile of the logged-in user' })
  @ApiWrappedResponse(UserPublicResponseDto)
  @ApiErrorResponses(401, 404, 429)
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }
}
