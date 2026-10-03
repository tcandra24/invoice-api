import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Terjadi kesalahan pada server';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          statusCode = HttpStatus.CONFLICT;
          message = 'Data sudah ada (duplikat)';
          break;
        case 'P2003':
          statusCode = HttpStatus.CONFLICT;
          message =
            'Data tidak bisa diproses karena masih berelasi dengan data lain atau referensi tidak valid';
          break;
        case 'P2025':
          statusCode = HttpStatus.NOT_FOUND;
          message = 'Data tidak ditemukan';
          break;
        case 'P2034':
          statusCode = HttpStatus.CONFLICT;
          message = 'Terjadi bentrokan proses, silakan coba lagi';
          break;
        default:
          this.logger.error(`Prisma error ${exception.code}`, exception.stack);
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    res.status(statusCode).json({
      success: false,
      statusCode,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
