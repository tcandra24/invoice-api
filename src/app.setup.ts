import helmet from 'helmet';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

import type { NextFunction, Request, Response } from 'express';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);

  // Header keamanan. Swagger UI memakai script/style inline, jadi
  // CSP dilonggarkan khusus path /docs saja.
  const secure = helmet();
  const docsFriendly = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith('/docs') ? docsFriendly : secure)(req, res, next),
  );

  // CORS: hanya origin yang terdaftar. Kosong berarti lintas origin ditolak.
  // Token dikirim lewat header Authorization (bukan cookie), jadi
  // credentials tidak perlu diaktifkan.
  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  console.log(origins);

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
}
