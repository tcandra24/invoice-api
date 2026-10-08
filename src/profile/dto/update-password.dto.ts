import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdatePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  oldPassword: string;

  // Aturan sama dengan register. 72 adalah batas byte bcrypt.
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72)
  newPassword: string;
}
