#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE_URL = (
  process.env.BACKEND_PUBLIC_URL ||
  process.env.RAILWAY_PUBLIC_DOMAIN_VALUE ||
  "http://localhost:9000"
).replace(/\/$/, "");
const EMAIL = process.env.MEDUSA_ADMIN_EMAIL?.trim();
const PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD;

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const login = async () => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD must be configured.",
    );
  }
  const res = await fetchJson(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  return res.token;
};

const fetchAllCategories = async (token) => {
  const categories = [];
  let offset = 0;
  const limit = 200;
  while (true) {
    const data = await fetchJson(
      `${BASE_URL}/admin/product-categories?limit=${limit}&offset=${offset}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    categories.push(...data.product_categories);
    if (categories.length >= data.count) {
      break;
    }
    offset += limit;
  }
  return categories;
};

const run = async () => {
  const token = await login();
  const categories = await fetchAllCategories(token);
  const handles = {};
  categories.forEach((cat) => {
    handles[cat.handle] = cat.id;
  });
  const output = {
    generated_at: new Date().toISOString(),
    total: categories.length,
    handles,
  };
  const outputPath = resolve("tmp", "category-map.json");
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Category map written to ${outputPath}`);
};

run().catch((err) => {
  console.error("Failed to export category map:", err);
  process.exit(1);
});
