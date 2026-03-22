import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq, and, asc, desc, count, SQL } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { CreateOrderDto, QueryOrderDto } from './dto';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly billingService: BillingService,
  ) {}

  async create(dto: CreateOrderDto) {
    const breakdown = await this.billingService.calculate({
      items: dto.items,
      couponCode: dto.couponCode,
    });

    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .insert(schema.orders)
        .values({
          couponCode: breakdown.couponCode,
          subtotal: breakdown.subtotal,
          taxAmount: breakdown.taxAmount,
          discountAmount: breakdown.discountAmount,
          totalAmount: breakdown.total,
          status: 'pending',
        })
        .returning();

      const orderItemValues = breakdown.items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      }));

      const items = await tx
        .insert(schema.orderItems)
        .values(orderItemValues)
        .returning();

      this.logger.log(`Order created: ${order.id} with ${items.length} items`);

      return { ...order, items };
    });
  }

  async findAll(query: QueryOrderDto) {
    const {
      status,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      order = 'desc',
    } = query;

    const conditions: SQL[] = [];

    if (status) {
      conditions.push(eq(schema.orders.status, status));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortColumn =
      schema.orders[sortBy as keyof typeof schema.orders.$inferSelect] ??
      schema.orders.createdAt;
    const sortOrder = order === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const offset = (page - 1) * limit;

    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(schema.orders)
        .where(where)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.orders).where(where),
    ]);

    return {
      data: items,
      meta: {
        total: total.count,
        page,
        limit,
        totalPages: Math.ceil(total.count / limit),
      },
    };
  }

  async findOne(id: string) {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, id),
      with: {
        items: {
          with: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }

    return order;
  }

  async updateStatus(id: string, status: string) {
    await this.findOne(id);

    const [updated] = await this.db
      .update(schema.orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.orders.id, id))
      .returning();

    this.logger.log(`Order ${id} status updated to "${status}"`);
    return updated;
  }

  async cancel(id: string) {
    const order = await this.findOne(id);

    if (order.status === 'cancelled') {
      throw new BadRequestException('Order is already cancelled');
    }

    if (order.status === 'delivered') {
      throw new BadRequestException('Cannot cancel a delivered order');
    }

    return this.updateStatus(id, 'cancelled');
  }
}
