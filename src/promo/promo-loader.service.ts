import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Validates promo codes via Redis sharded SET lookups.
 *
 * ▸ O(1) lookups — codes are sharded into SETs by first character
 *   (coupons:A .. coupons:Z, coupons:0 .. coupons:9).
 * ▸ Bulk-loaded by preprocess-coupons.js using redis-cli --pipe.
 * ▸ Zero memory overhead in the Node.js process.
 */
@Injectable()
export class PromoLoaderService implements OnModuleDestroy {
  private readonly logger = new Logger(PromoLoaderService.name);
  private readonly prefix = 'coupons';
  private readonly fileLabels = ['couponbase1', 'couponbase2', 'couponbase3'];
  private readonly minFileCount = 2;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) { }

  /** e.g. coupons:couponbase1:A */
  private shardKey(fileLabel: string, code: string): string {
    return `${this.prefix}:${fileLabel}:${code[0].toUpperCase()}`;
  }

  async isReady(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Validate a single promo code.
   * Valid only if the code exists in at least 2 of the 3 coupon files.
   */
  async isValid(code: string): Promise<boolean> {
    const pipeline = this.redis.pipeline();
    for (const label of this.fileLabels) {
      pipeline.sismember(this.shardKey(label, code), code);
    }
    const results = await pipeline.exec();
    let count = 0;
    for (const [err, val] of results!) {
      if (!err && val === 1) count++;
    }
    this.logger.debug(
      `Code ${code} found in ${count}/${this.fileLabels.length} files`,
    );
    return count >= this.minFileCount;
  }

  /**
   * Validate multiple promo codes using a pipeline.
   * Each code must exist in at least 2 files to be valid.
   */
  async validateMany(codes: string[]): Promise<Record<string, boolean>> {
    const pipeline = this.redis.pipeline();
    // For each code, check all file-specific shards
    for (const code of codes) {
      for (const label of this.fileLabels) {
        pipeline.sismember(this.shardKey(label, code), code);
      }
    }

    const results = await pipeline.exec();
    const output: Record<string, boolean> = {};
    const fileCount = this.fileLabels.length;

    codes.forEach((code, i) => {
      let count = 0;
      for (let j = 0; j < fileCount; j++) {
        const [err, val] = results![i * fileCount + j];
        if (!err && val === 1) count++;
      }
      output[code] = count >= this.minFileCount;
    });

    return output;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('Redis connection closed.');
  }
}
