import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

process.env.NODE_ENV = "test";

const rootDirectory = process.cwd();
const backendRequire = createRequire(
  path.join(rootDirectory, "backend/package.json"),
);
const { configManager } = backendRequire("@medusajs/framework/config");
const { expressLoader } = backendRequire("@medusajs/framework/http");
const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'",
};
const logger = {
  http: () => {},
  log: () => {},
  shouldLog: () => false,
};

configManager.loadConfig({
  baseDir: rootDirectory,
  projectConfig: {
    logger,
    projectConfig: {
      http: {
        adminCors: "",
        authCors: "",
        cookieSecret: "test",
        jwtSecret: "test",
        responseHeaders,
        storeCors: "",
      },
    },
  },
});

const disabledSettings = [];
const registeredMiddleware = [];
const app = {
  disable: (name) => {
    disabledSettings.push(name);
    return app;
  },
  set: () => app,
  use: (...middleware) => {
    registeredMiddleware.push(middleware);
    return app;
  },
};

const { shutdown } = await expressLoader({
  app,
  container: { resolve: () => logger },
});
const emittedHeaders = new Map();
let advanced = false;

registeredMiddleware[0]?.[0]?.(
  {},
  {
    setHeader: (name, value) => {
      emittedHeaders.set(name, value);
    },
  },
  () => {
    advanced = true;
  },
);

assert.equal(advanced, true);
assert.deepEqual(Object.fromEntries(emittedHeaders), responseHeaders);
assert.deepEqual(disabledSettings, ["x-powered-by"]);

await shutdown();

console.log(
  "Medusa framework response headers verified before framework routers.",
);
