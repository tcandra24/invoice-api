import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// String kosong dianggap menghapus nilai (menjadi null)
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export class UpdateProfileDto {
  // Opsional, tetapi kalau dikirim tidak boleh kosong atau null
  @ValidateIf((dto: UpdateProfileDto) => dto.name !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  // null atau string kosong menghapus nama usaha
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  businessName?: string | null;
}
