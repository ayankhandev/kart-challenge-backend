import {
  Inject,
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { PromoLoaderService } from '../promo/promo-loader.service';
import {
  BillingInput,
  BillingBreakdown,
  BillingLineItem,
} from './interfaces/billing.interfaces';

const TAX_RATE = 0.18;
const PROMO_DISCOUNT_RATE = 0.1;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly promoLoader: PromoLoaderService,
  ) {}

  async calculate(input: BillingInput): Promise<BillingBreakdown> {
    const productIds = input.items.map((item) => item.productId);

    // Fetch and validate products
    const foundProducts = await this.db
      .select()
      .from(schema.products)
      .where(inArray(schema.products.id, productIds));

    const productMap = new Map(foundProducts.map((p) => [p.id, p]));

    const missingIds = productIds.filter((id) => !productMap.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(
        `Products not found: ${missingIds.join(', ')}`,
      );
    }

    // Build line items
    const items: BillingLineItem[] = input.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const lineTotal = Math.round(product.price * item.quantity * 100) / 100;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: product.price,
        lineTotal,
      };
    });

    const subtotal =
      Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) /
      100;

    // Validate coupon and compute discount
    let discountRate = 0;
    let discountAmount = 0;
    let couponCode: string | null = null;

    if (input.couponCode) {
      const code = input.couponCode.trim();
      if (code.length < 8 || code.length > 10) {
        throw new BadRequestException(
          'Promo code must be 8-10 characters long',
        );
      }
      if (!(await this.promoLoader.isReady())) {
        throw new BadRequestException(
          'Promo code service is not available. Please try again later.',
        );
      }
      if (!(await this.promoLoader.isValid(code))) {
        throw new BadRequestException(`Invalid promo code: ${code}`);
      }

      discountRate = PROMO_DISCOUNT_RATE;
      discountAmount = Math.round(subtotal * PROMO_DISCOUNT_RATE * 100) / 100;
      couponCode = code;
      this.logger.log(
        `Promo code "${code}" applied — discount: $${discountAmount}`,
      );
    }

    // Compute tax and total
    const taxAmount = Math.round(subtotal * TAX_RATE * 100) / 100;
    const total =
      Math.round((subtotal + taxAmount - discountAmount) * 100) / 100;

    return {
      items,
      subtotal,
      taxRate: TAX_RATE,
      taxAmount,
      discountRate,
      discountAmount,
      total,
      couponCode,
    };
  }
}
