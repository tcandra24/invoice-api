import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Di belakang proxy Railway, supaya rate limit membaca IP client asli
  app.set('trust proxy', 1);
  configureApp(app);

  if (config.get<string>('SWAGGER_ENABLED') !== 'false') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Invoice & Payment Reminder API')
      .setDescription(
        'API for creating invoices, recording payments, and sending automatic reminders to clients.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Agar PrismaService.onModuleDestroy dipanggil saat container dihentikan
  app.enableShutdownHooks();

  await app.listen(config.get<number>('PORT') ?? 3000, '0.0.0.0');
}
void bootstrap();
