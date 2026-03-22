import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { eq, ilike, or, and, asc, desc, count, SQL } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { QueryProductDto } from './dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAll(query: QueryProductDto) {
    const {
      search,
      category,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      order = 'desc',
    } = query;

    const conditions: SQL[] = [];

    if (search) {
      conditions.push(
        or(
          ilike(schema.products.name, `%${search}%`),
          ilike(schema.products.category, `%${search}%`),
        )!,
      );
    }
    if (category) {
      conditions.push(eq(schema.products.category, category));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortColumn =
      schema.products[sortBy as keyof typeof schema.products.$inferSelect] ??
      schema.products.createdAt;
    const sortOrder = order === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const offset = (page - 1) * limit;

    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(schema.products)
        .where(where)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.products).where(where),
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
    const [product] = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);

    if (!product) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }

    return product;
  }
}
