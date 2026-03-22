import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { products } from './schemas/products.schema';

const seedData = [
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-waffle-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-waffle-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-waffle-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-waffle-desktop.jpg',
    },
    name: 'Waffle with Berries',
    category: 'Waffle',
    price: 6.5,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-desktop.jpg',
    },
    name: 'Vanilla Bean Crème Brûlée',
    category: 'Crème Brûlée',
    price: 7,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-macaron-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-macaron-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-macaron-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-macaron-desktop.jpg',
    },
    name: 'Macaron Mix of Five',
    category: 'Macaron',
    price: 8,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-tiramisu-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-tiramisu-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-tiramisu-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-tiramisu-desktop.jpg',
    },
    name: 'Classic Tiramisu',
    category: 'Tiramisu',
    price: 5.5,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-baklava-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-baklava-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-baklava-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-baklava-desktop.jpg',
    },
    name: 'Pistachio Baklava',
    category: 'Baklava',
    price: 4,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-meringue-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-meringue-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-meringue-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-meringue-desktop.jpg',
    },
    name: 'Lemon Meringue Pie',
    category: 'Pie',
    price: 5,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-cake-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-cake-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-cake-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-cake-desktop.jpg',
    },
    name: 'Red Velvet Cake',
    category: 'Cake',
    price: 4.5,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-brownie-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-brownie-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-brownie-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-brownie-desktop.jpg',
    },
    name: 'Salted Caramel Brownie',
    category: 'Brownie',
    price: 4.5,
  },
  {
    image: {
      thumbnail:
        'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-thumbnail.jpg',
      mobile:
        'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-mobile.jpg',
      tablet:
        'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-tablet.jpg',
      desktop:
        'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-desktop.jpg',
    },
    name: 'Vanilla Panna Cotta',
    category: 'Panna Cotta',
    price: 6.5,
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const queryClient = postgres(connectionString);
  const db = drizzle(queryClient);

  console.log('Clearing existing products...');
  await db.delete(products);

  console.log('Inserting seed data...');
  await db.insert(products).values(seedData);

  console.log('Seeding completed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed!');
  console.error(err);
  process.exit(1);
});
