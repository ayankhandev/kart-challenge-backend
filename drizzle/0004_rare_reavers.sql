ALTER TABLE "orders" ADD COLUMN "subtotal" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_amount" real DEFAULT 0 NOT NULL;