import { IsDateString, IsOptional } from 'class-validator';

export class RunRemindersDto {
  // Simulasi tanggal "hari ini" untuk pengujian, contoh: 2026-11-12
  @IsOptional()
  @IsDateString()
  asOf?: string;
}
