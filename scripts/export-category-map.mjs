#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { writePrivateJsonArtifact } from "./lib/private-json-artifact.mjs";

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 200;
const MAX_CATEGORY_COUNT = 10_000;
const MAX_PAGE_COUNT = Math.ceil(MAX_CATEGORY_COUNT / PAGE_SIZE);
const CATEGORY_ID_PATTERN = /^pcat_[A-Za-z0-9_-]{1,122}$/u;
const CATEGORY_HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const parseBaseUrl = (value) => {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Backend URL must use HTTP(S) and must not contain credentials.",
    );
  }
  return url.href.replace(/\/$/u, "");
};

const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN_VALUE?.trim();
const BASE_URL = parseBaseUrl(
  process.env.BACKEND_PUBLIC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : "http://localhost:9000"),
);
const EMAIL = process.env.MEDUSA_ADMIN_EMAIL?.trim();
const PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD;

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Request failed ${res.status} ${res.statusText}.`);
  }
  return res.json();
};

const parseAuthenticationResponse = (value) => {
  if (
    !isRecord(value) ||
    typeof value.token !== "string" ||
    value.token.length === 0 ||
    value.token.length > 8_192 ||
    !/^[A-Za-z0-9._~-]+$/u.test(value.token)
  ) {
    throw new Error("Authentication response did not contain a valid token.");
  }
  return value.token;
};

export const parseCategoryPage = (value) => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.product_categories) ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0 ||
    value.count > MAX_CATEGORY_COUNT ||
    value.product_categories.length > PAGE_SIZE
  ) {
    throw new Error("Category response did not match the bounded page schema.");
  }

  const productCategories = value.product_categories.map((category) => {
    if (
      !isRecord(category) ||
      typeof category.id !== "string" ||
      !CATEGORY_ID_PATTERN.test(category.id) ||
      typeof category.handle !== "string" ||
      !CATEGORY_HANDLE_PATTERN.test(category.handle) ||
      category.handle.length > 128
    ) {
      throw new Error("Category response contained an invalid ID or handle.");
    }
    return { handle: category.handle, id: category.id };
  });

  return { count: value.count, productCategories };
};

const login = async () => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD must be configured.",
    );
  }
  const response = await fetchJson(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  return parseAuthenticationResponse(response);
};

const fetchAllCategories = async (token) => {
  const categories = [];
  let offset = 0;
  let expectedCount;
  for (let pageNumber = 0; pageNumber < MAX_PAGE_COUNT; pageNumber += 1) {
    const response = await fetchJson(
      `${BASE_URL}/admin/product-categories?limit=${PAGE_SIZE}&offset=${offset}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const page = parseCategoryPage(response);
    expectedCount ??= page.count;
    if (page.count !== expectedCount) {
      throw new Error("Category count changed during the paginated export.");
    }
    categories.push(...page.productCategories);
    if (categories.length > expectedCount) {
      throw new Error("Category response exceeded its declared count.");
    }
    if (categories.length === expectedCount) {
      return categories;
    }
    if (page.productCategories.length === 0) {
      throw new Error("Category pagination ended before the declared count.");
    }
    offset = categories.length;
  }
  throw new Error("Category export exceeded its maximum page count.");
};

export const buildCategoryMap = (categories) => {
  const handles = Object.create(null);
  for (const { handle, id } of [...categories].sort((left, right) =>
    left.handle.localeCompare(right.handle),
  )) {
    if (Object.hasOwn(handles, handle)) {
      throw new Error(`Category handle '${handle}' is duplicated.`);
    }
    handles[handle] = id;
  }
  return handles;
};

const run = async () => {
  const token = await login();
  const categories = await fetchAllCategories(token);
  const handles = buildCategoryMap(categories);
  const output = {
    generated_at: new Date().toISOString(),
    total: categories.length,
    handles,
  };
  const outputPath = await writePrivateJsonArtifact({
    baseDirectory: process.cwd(),
    fileName: "category-map.json",
    relativeDirectory: "tmp",
    value: output,
  });
  console.log(`Category map written to ${outputPath}`);
};

const entryPoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (entryPoint === import.meta.url) {
  run().catch((error) => {
    console.error("Failed to export category map:", error);
    process.exitCode = 1;
  });
}
