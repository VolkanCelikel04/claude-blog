import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './common/config/configuration';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  const port = config.getOrThrow<number>('port');
  const host = config.getOrThrow<string>('host');
  const apiPrefix = config.getOrThrow<string>('apiPrefix');
  const corsOrigins = config.getOrThrow<string[]>('corsOrigins');
  const env = config.getOrThrow<AppConfig['env']>('env');

  app.setGlobalPrefix(apiPrefix);
  app.use(helmet());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Unknown properties are an error, not something to silently drop. This
      // is also the first line of defence for the vault boundary: a client
      // cannot smuggle an extra field into any DTO.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  if (env !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Vgantt Suite API')
        .setDescription('Multi-tenant SaaS: tenant izolasyonu, modül lisanslama, uyarı motoru')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
  }

  // Binding to 127.0.0.1 in production keeps the API off the public interface;
  // nginx on the same host is what the outside world talks to.
  await app.listen(port, host);
  new Logger('Bootstrap').log(`Vgantt Suite API listening on ${host}:${port}/${apiPrefix} [${env}]`);
}

void bootstrap();
