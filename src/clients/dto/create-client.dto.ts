import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsEmail({}, { message: 'email tidak valid' })
  email?: string;

  @IsOptional()
  @Matches(/^(\+62|62|0)8[0-9]{8,11}$/, {
    message: 'phone harus berupa nomor HP Indonesia yang valid',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}
