import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VoidPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string; // contoh: "salah input nominal"
}
