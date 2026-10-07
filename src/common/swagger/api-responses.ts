import { HttpStatus, Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../dto/api-error-response.dto';
import { PaginationMetaDto } from '../dto/pagination-meta.dto';

interface WrappedOptions {
  status?: number;
  description?: string;
  isArray?: boolean;
}

/** Dokumentasi response sukses: { success: true, data: <model> } */
export function ApiWrappedResponse(
  model: Type<unknown>,
  options: WrappedOptions = {},
) {
  const { status = HttpStatus.OK, description, isArray = false } = options;

  const data = isArray
    ? { type: 'array', items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data,
        },
      },
    }),
  );
}

/** Dokumentasi daftar berpagination: { success, data: { items, meta } } */
export function ApiPaginatedResponse(
  model: Type<unknown>,
  options: { status?: number; description?: string } = {},
) {
  const { status = HttpStatus.OK, description } = options;

  return applyDecorators(
    ApiExtraModels(model, PaginationMetaDto),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            required: ['items', 'meta'],
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(model) } },
              meta: { $ref: getSchemaPath(PaginationMetaDto) },
            },
          },
        },
      },
    }),
  );
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid request (validation failed or business rules violated)',
  401: 'Token not found, invalid, or expired',
  403: 'Forbidden',
  404: 'Data not found (or not owned by this user)',
  409: 'Conflict (duplicate, still related, or process clash)',
  429: 'Too many requests',
  502: 'Failed to send email to client',
};

/** Dokumentasi response error dengan format baku AllExceptionsFilter. */
export function ApiErrorResponses(...statuses: number[]) {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status] ?? 'Error',
        type: ApiErrorResponseDto,
      }),
    ),
  );
}
