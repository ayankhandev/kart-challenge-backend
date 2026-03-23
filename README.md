# Nest Ordering API

A REST API for a food ordering system built with NestJS, PostgreSQL (Drizzle ORM), and Redis. Supports product browsing, order placement with billing (tax + discount), and high-throughput promo code validation against 300M+ coupon codes.

## Tech Stack

- **Runtime**: Node.js 22 + NestJS 11
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Cache**: Redis 7 (promo code storage)
- **Package Manager**: pnpm
- **Containerization**: Docker + Docker Compose

## Prerequisites

- Node.js >= 22
- pnpm
- PostgreSQL 16+
- Redis 7+
- `redis-cli` (for coupon preprocessing)

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d db redis
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

Create a `.env` file in the project root:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/nest_ordering
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=development
```

Only `DATABASE_URL` is required. Others have defaults.

### 4. Run migrations and seed

```bash
pnpm run db:generate
pnpm run db:migrate
pnpm run db:seed
```

### 5. Load coupon codes (optional)

Place `couponbase1.gz`, `couponbase2.gz`, `couponbase3.gz` in the `data/` directory, then:

```bash
pnpm run preprocess-coupons
```

This loads ~300M coupon codes into Redis at 10M+ codes/second using worker threads and `redis-cli --pipe`.

### 6. Start the server

```bash
# Development (watch mode)
pnpm run dev

# Production
pnpm run build
pnpm run start:prod
```

The API is available at `http://localhost:3000/api`.

## Docker

Run the entire stack:

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, and the API. The API is exposed on port 3000.

### Helpful Docker Commands

| Command                              | Description                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `docker compose up -d`               | Start all services in the background                                                      |
| `docker compose up --build -d`       | Rebuild and start container after code changes                                            |
| `docker compose logs -f`             | Tail logs for all running services                                                        |
| `docker compose logs -f api`         | Tail logs for specifically the API service                                                |
| `docker compose run --rm preprocess` | Manually run the promo code preprocessing step (useful if you added the data files later) |
| `docker compose down`                | Stop and remove containers                                                                |
| `docker compose down -v`             | Stop, remove containers, and **delete entire database/redis volumes**                     |

## API Endpoints

All endpoints are prefixed with `/api`.

### Products

| Method | Endpoint            | Description                                                   |
| ------ | ------------------- | ------------------------------------------------------------- |
| GET    | `/api/products`     | List products (paginated, searchable, filterable by category) |
| GET    | `/api/products/:id` | Get a single product                                          |

**Query params** for `GET /api/products`:

| Param      | Type   | Default   | Description                      |
| ---------- | ------ | --------- | -------------------------------- |
| `search`   | string | -         | Search by product name           |
| `category` | string | -         | Filter by category               |
| `page`     | number | 1         | Page number                      |
| `limit`    | number | 20        | Items per page                   |
| `sortBy`   | string | createdAt | name, price, category, createdAt |
| `order`    | string | desc      | asc or desc                      |

### Orders

| Method | Endpoint                 | Description                                   |
| ------ | ------------------------ | --------------------------------------------- |
| POST   | `/api/orders`            | Create an order                               |
| GET    | `/api/orders`            | List orders (paginated, filterable by status) |
| GET    | `/api/orders/:id`        | Get order with items and product details      |
| PATCH  | `/api/orders/:id/cancel` | Cancel an order                               |

**Create order** `POST /api/orders`:

```json
{
  "items": [{ "productId": 1, "quantity": 2 }],
  "couponCode": "AFNQ7W9S"
}
```

Only `productId` (integer) and `quantity` are required per item. Prices are fetched from the database. The `couponCode` is optional (8-10 characters).

**Response** includes the full billing breakdown:

```json
{
  "id": "uuid",
  "status": "pending",
  "couponCode": "AFNQ7W9S",
  "subtotal": 13.00,
  "taxAmount": 2.34,
  "discountAmount": 1.30,
  "totalAmount": 14.04,
  "createdAt": "2026-03-22T...",
  "items": [...]
}
```

**Query params** for `GET /api/orders`:

| Param    | Type   | Default   | Description                                                |
| -------- | ------ | --------- | ---------------------------------------------------------- |
| `status` | string | -         | pending, confirmed, preparing, ready, delivered, cancelled |
| `page`   | number | 1         | Page number                                                |
| `limit`  | number | 20        | Items per page                                             |
| `sortBy` | string | createdAt | createdAt, totalAmount                                     |
| `order`  | string | desc      | asc or desc                                                |

### Promo Codes

| Method | Endpoint                    | Description                      |
| ------ | --------------------------- | -------------------------------- |
| GET    | `/api/promo/health`         | Check Redis/promo service health |
| GET    | `/api/promo/validate/:code` | Validate a single promo code     |
| POST   | `/api/promo/validate`       | Bulk validate up to 1000 codes   |

**Bulk validate** `POST /api/promo/validate`:

```json
{
  "codes": ["CODE1ABC", "CODE2DEF"]
}
```

## Billing Logic

The `BillingService` handles all pricing calculations:

| Component | Rate | Formula                           |
| --------- | ---- | --------------------------------- |
| Subtotal  | -    | Sum of (unit price x quantity)    |
| Tax       | 18%  | subtotal x 0.18                   |
| Discount  | 10%  | subtotal x 0.10 (if valid coupon) |
| **Total** | -    | **subtotal + tax - discount**     |

All amounts are rounded to 2 decimal places.

## Promo Code Architecture

Coupon codes are stored in Redis sharded SETs for O(1) lookups:

- **Key format**: `coupons:<file>:<first_char>` (e.g., `coupons:couponbase1:A`)
- **Shards**: 36 per file (A-Z, 0-9) across 3 files = 108 Redis keys
- **Validation rule**: A code is valid only if it exists in at least 2 of the 3 coupon files

The preprocessing script uses worker threads (one per `.gz` file) with `redis-cli --pipe` for bulk loading at 10M+ codes/second throughput.

## Database Schema

### products

| Column     | Type         | Description                                     |
| ---------- | ------------ | ----------------------------------------------- |
| id         | serial       | Primary key (auto-increment integer)            |
| name       | varchar(255) | Product name                                    |
| category   | varchar(100) | Product category                                |
| price      | real         | Product price                                   |
| image      | jsonb        | Image URLs (thumbnail, mobile, tablet, desktop) |
| created_at | timestamp    | Creation timestamp                              |
| updated_at | timestamp    | Last update timestamp                           |

### orders

| Column          | Type         | Description                                                |
| --------------- | ------------ | ---------------------------------------------------------- |
| id              | uuid         | Primary key                                                |
| status          | varchar(50)  | pending, confirmed, preparing, ready, delivered, cancelled |
| coupon_code     | varchar(100) | Applied coupon code (nullable)                             |
| subtotal        | real         | Sum of line items                                          |
| tax_amount      | real         | Tax (18% of subtotal)                                      |
| discount_amount | real         | Discount (10% if valid coupon)                             |
| total_amount    | real         | Final amount (subtotal + tax - discount)                   |
| created_at      | timestamp    | Creation timestamp                                         |
| updated_at      | timestamp    | Last update timestamp                                      |

### order_items

| Column     | Type      | Description                   |
| ---------- | --------- | ----------------------------- |
| id         | uuid      | Primary key                   |
| order_id   | uuid      | FK to orders (cascade delete) |
| product_id | integer   | FK to products                |
| quantity   | integer   | Item quantity                 |
| unit_price | real      | Price at time of order        |
| created_at | timestamp | Creation timestamp            |

## Project Structure

```
src/
  main.ts                          # Bootstrap + global pipes
  app.module.ts                    # Root module
  config/
    env.validation.ts              # Environment variable validation
  database/
    database.module.ts             # Drizzle ORM setup (global)
    schema.ts                      # Schema barrel export
    seed.ts                        # Legacy seed script
    schemas/
      products.schema.ts
      orders.schema.ts
  products/
    products.controller.ts         # GET /products, GET /products/:id
    products.service.ts
    products.module.ts
    dto/
  orders/
    orders.controller.ts           # POST /orders, GET /orders, PATCH cancel
    orders.service.ts
    orders.module.ts
    dto/
  billing/
    billing.service.ts             # Subtotal, tax, discount, total calculation
    billing.module.ts
    interfaces/
      billing.interfaces.ts
  promo/
    promo.controller.ts            # Promo validation endpoints
    promo-loader.service.ts        # Redis-backed O(1) coupon lookup
    promo.module.ts
scripts/
  preprocess-coupons.js            # Bulk-load coupons into Redis
  seed-products.js                 # Seed product data
drizzle/                           # Migration files
```

## Available Scripts

| Script                        | Description                 |
| ----------------------------- | --------------------------- |
| `pnpm run dev`                | Start in watch mode         |
| `pnpm run build`              | Build for production        |
| `pnpm run start:prod`         | Run production build        |
| `pnpm run lint`               | Lint and auto-fix           |
| `pnpm run format`             | Format with Prettier        |
| `pnpm run test`               | Run unit tests              |
| `pnpm run test:e2e`           | Run e2e tests               |
| `pnpm run db:generate`        | Generate Drizzle migrations |
| `pnpm run db:migrate`         | Apply migrations            |
| `pnpm run db:seed`            | Seed product data           |
| `pnpm run db:studio`          | Open Drizzle Studio         |
| `pnpm run preprocess-coupons` | Load coupons into Redis     |

## Frontend Integration

A seamlessly integrated Next.js POS interface is provided in the `next-ordering` repository. To connect it to this backend:

1. Ensure the backend is running on port `3000` (`pnpm run dev`).
2. In the Next.js frontend directory, create an `.env` file with `NEXT_PUBLIC_API_URL=http://localhost:3000/api`.
3. Start the Next.js dev server (`pnpm run dev`) and access the POS UI. CORS is fully enabled by the backend to support local cross-port requests smoothly.
