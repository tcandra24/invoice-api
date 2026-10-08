import { Controller, Body, Patch } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChangePasswordResponseDto } from './dto/profile-response.dto';
import { UserPublicResponseDto } from '../auth/dto/auth-response.dto';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiWrappedResponse,
} from '../common/swagger/api-responses';

@ApiTags('profile')
@ApiBearerAuth()
@ApiErrorResponses(400, 401, 429)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Patch()
  @ApiOperation({
    summary:
      'Update profile (name, businessName). Send only the fields to change; an empty businessName clears it',
  })
  @ApiWrappedResponse(UserPublicResponseDto)
  @ApiErrorResponses(404)
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.profileService.update(userId, dto);
  }

  @Patch('password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Change password. All sessions (refresh tokens) are revoked',
  })
  @ApiWrappedResponse(ChangePasswordResponseDto)
  @ApiErrorResponses(404)
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePasswordDto,
  ) {
    return this.profileService.changePassword(userId, dto);
  }
}
