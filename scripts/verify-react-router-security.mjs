import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

process.env.NODE_ENV = "production";

const rootDirectory = process.cwd();
const backendRequire = createRequire(
  path.join(rootDirectory, "backend/package.json"),
);
const dashboardRequire = createRequire(
  backendRequire.resolve("@medusajs/dashboard/package.json"),
);
const reactRouterDomPackagePath = dashboardRequire.resolve(
  "react-router-dom/package.json",
);
const reactRouterDomRequire = createRequire(reactRouterDomPackagePath);
const remixRouterPackagePath = reactRouterDomRequire.resolve(
  "@remix-run/router/package.json",
);
const remixRouterRequire = createRequire(remixRouterPackagePath);
const storefrontRequire = createRequire(
  path.join(rootDirectory, "storefront/package.json"),
);

const reactRouterDomPackage = reactRouterDomRequire("./package.json");
const remixRouterPackage = remixRouterRequire("./package.json");

assert.equal(reactRouterDomPackage.version, "6.30.4");
assert.equal(remixRouterPackage.version, "1.23.3");

const remixRouter = remixRouterRequire("@remix-run/router");
const mixedSeparatorPaths = ["//safe", "\\\\safe", "/\\safe", "\\/safe"];

for (const candidate of mixedSeparatorPaths) {
  assert.equal(remixRouter.resolvePath(candidate).pathname, "/safe");
}

assert.equal(
  remixRouter.resolvePath("foo:bar", "/base").pathname,
  "/base/foo:bar",
);

for (const location of [
  "//localhost/safe",
  "\\\\localhost/safe",
  "/\\localhost/safe",
  "\\/localhost/safe",
]) {
  const router = remixRouter.createRouter({
    history: remixRouter.createMemoryHistory(),
    routes: [
      {
        path: "/",
        children: [
          { index: true },
          {
            path: "redirect",
            loader: () =>
              new Response(null, {
                status: 302,
                headers: { Location: location },
              }),
          },
          { path: "safe" },
        ],
      },
    ],
  });

  await router.navigate("/redirect");
  assert.equal(router.state.location.pathname, "/safe");
  router.dispose();
}

const { JSDOM } = storefrontRequire("jsdom");
const jsdom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "https://localhost/" },
);
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;

try {
  globalThis.window = jsdom.window;
  globalThis.document = jsdom.window.document;

  let customErrorConstructions = 0;
  window.NetworkProbe = class NetworkProbe extends Error {
    constructor(message) {
      super(message);
      customErrorConstructions += 1;
    }
  };
  window.__staticRouterHydrationData = {
    loaderData: {},
    actionData: null,
    errors: {
      root: {
        message: "blocked",
        __type: "Error",
        __subType: "NetworkProbe",
      },
    },
  };

  const React = reactRouterDomRequire("react");
  const ReactDOM = reactRouterDomRequire("react-dom");
  const ReactDOMClient = reactRouterDomRequire("react-dom/client");
  const reactRouterDom = reactRouterDomRequire("react-router-dom");
  const hydrationRouter = reactRouterDom.createBrowserRouter(
    [{ id: "root", path: "/", element: null }],
    { window },
  );
  const hydrationError = hydrationRouter.state.errors.root;

  assert.equal(customErrorConstructions, 0);
  assert.equal(hydrationError.constructor, Error);
  assert.equal(hydrationError.message, "blocked");
  hydrationRouter.dispose();

  delete window.__staticRouterHydrationData;

  const rootElement = document.querySelector("#root");
  const reactRoot = ReactDOMClient.createRoot(rootElement);

  ReactDOM.flushSync(() => {
    reactRoot.render(
      React.createElement(
        reactRouterDom.BrowserRouter,
        { window },
        React.createElement(
          reactRouterDom.Link,
          { to: "\\\\localhost/safe" },
          "safe",
        ),
      ),
    );
  });

  const link = document.querySelector("a");
  assert.ok(link);

  link.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    }),
  );
  await delay(0);

  assert.equal(window.location.origin, "https://localhost");
  assert.equal(window.location.pathname, "/safe");
  reactRoot.unmount();
} finally {
  jsdom.window.close();

  if (previousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }

  if (previousDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = previousDocument;
  }
}

console.log(
  "React Router 6.30.4 security backports verified in production artifacts.",
);
