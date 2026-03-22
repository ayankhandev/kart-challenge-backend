import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PromoLoaderService } from './promo-loader.service';
import { IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';

class ValidateBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  codes: string[];
}

@Controller('promo')
export class PromoController {
  constructor(private readonly promoLoader: PromoLoaderService) {}

  @Get('health')
  async health() {
    if (!(await this.promoLoader.isReady())) {
      throw new ServiceUnavailableException(
        'Promo database is unavailable. Is Redis running?',
      );
    }
    return { status: 'ok', mode: 'redis' };
  }

  @Get('validate/:code')
  async validateOne(@Param('code') code: string) {
    await this.ensureReady();
    this.assertCodeFormat(code);
    const valid = await this.promoLoader.isValid(code);
    return { code, valid };
  }

  @Post('validate')
  async validateBulk(@Body() dto: ValidateBulkDto) {
    await this.ensureReady();

    const results: Record<string, boolean> = {};
    const validCodes: string[] = [];

    for (const raw of dto.codes) {
      const code = String(raw).trim();
      if (code.length < 8 || code.length > 10) {
        results[code] = false;
      } else {
        validCodes.push(code);
      }
    }

    if (validCodes.length > 0) {
      const redisResults = await this.promoLoader.validateMany(validCodes);
      Object.assign(results, redisResults);
    }

    return { results };
  }

  private async ensureReady(): Promise<void> {
    if (!(await this.promoLoader.isReady())) {
      throw new ServiceUnavailableException(
        'Promo database is unavailable. Is Redis running?',
      );
    }
  }

  private assertCodeFormat(code: string): void {
    if (code.length < 8 || code.length > 10) {
      throw new BadRequestException('Promo code must be 8-10 characters long');
    }
  }
}
