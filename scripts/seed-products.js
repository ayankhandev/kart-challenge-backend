#!/usr/bin/env node
'use strict';

require('dotenv/config');
const postgres = require('postgres');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const PRODUCTS = [
  {
    name: 'Waffle with Berries',
    category: 'Waffle',
    price: 6.5,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-waffle-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-waffle-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-waffle-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-waffle-desktop.jpg',
    },
  },
  {
    name: 'Vanilla Bean Crème Brûlée',
    category: 'Crème Brûlée',
    price: 7,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-creme-brulee-desktop.jpg',
    },
  },
  {
    name: 'Macaron Mix of Five',
    category: 'Macaron',
    price: 8,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-macaron-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-macaron-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-macaron-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-macaron-desktop.jpg',
    },
  },
  {
    name: 'Classic Tiramisu',
    category: 'Tiramisu',
    price: 5.5,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-tiramisu-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-tiramisu-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-tiramisu-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-tiramisu-desktop.jpg',
    },
  },
  {
    name: 'Pistachio Baklava',
    category: 'Baklava',
    price: 4,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-baklava-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-baklava-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-baklava-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-baklava-desktop.jpg',
    },
  },
  {
    name: 'Lemon Meringue Pie',
    category: 'Pie',
    price: 5,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-meringue-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-meringue-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-meringue-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-meringue-desktop.jpg',
    },
  },
  {
    name: 'Red Velvet Cake',
    category: 'Cake',
    price: 4.5,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-cake-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-cake-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-cake-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-cake-desktop.jpg',
    },
  },
  {
    name: 'Salted Caramel Brownie',
    category: 'Brownie',
    price: 4.5,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-brownie-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-brownie-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-brownie-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-brownie-desktop.jpg',
    },
  },
  {
    name: 'Vanilla Panna Cotta',
    category: 'Panna Cotta',
    price: 6.5,
    image: {
      thumbnail: 'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-thumbnail.jpg',
      mobile: 'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-mobile.jpg',
      tablet: 'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-tablet.jpg',
      desktop: 'https://orderfoodonline.deno.dev/public/images/image-panna-cotta-desktop.jpg',
    },
  },
];

async function main() {
  const sql = postgres(DATABASE_URL);

  try {
    console.log('==> Clearing existing products...');
    await sql`DELETE FROM products`;

    console.log('==> Inserting seed products...');
    await sql`INSERT INTO products ${sql(PRODUCTS, 'name', 'category', 'price', 'image')}`;

    console.log(`==> Seeded ${PRODUCTS.length} products successfully!`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
