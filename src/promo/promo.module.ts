import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PromoController } from './promo.controller';
import { PromoLoaderService } from './promo-loader.service';

const RedisProvider = {
  provide: 'REDIS_CLIENT',
  useFactory: (config: ConfigService) => {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    return new Redis(url);
  },
  inject: [ConfigService],
};

@Module({
  controllers: [PromoController],
  providers: [RedisProvider, PromoLoaderService],
  exports: [PromoLoaderService],
})
export class PromoModule {}
