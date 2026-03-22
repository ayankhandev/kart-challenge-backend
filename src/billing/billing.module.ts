import { Module } from '@nestjs/common';
import { PromoModule } from '../promo/promo.module';
import { BillingService } from './billing.service';

@Module({
  imports: [PromoModule],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
