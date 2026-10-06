import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import vm from "node:vm"

const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const dashboardRequire = createRequire(
  backendRequire.resolve("@medusajs/dashboard/package.json")
)
const resolverRoot = dirname(
  dashboardRequire.resolve("@hookform/resolvers/package.json")
)
const resolverRequire = createRequire(join(resolverRoot, "package.json"))
const z4 = dashboardRequire("zod")
const z3 = dashboardRequire("zod/v3")
const options = { fields: {}, shouldUseNativeValidation: false }

const dashboardRoot = dirname(
  backendRequire.resolve("@medusajs/dashboard/package.json")
)
const draftOrderRoot = dirname(
  backendRequire.resolve("@medusajs/draft-order/package.json")
)

for (const entry of ["order-receive-return-HEIGUW3S.mjs", "app.js"]) {
  test(`${entry}: receiving skips unchanged quantities and preserves native mutations`, async () => {
    const source = readFileSync(join(dashboardRoot, "dist", entry), "utf8")
    const start = source.indexOf("function OrderReceiveReturnForm(")
    const end = source.indexOf("  return /* @__PURE__ */", start)
    assert.ok(start >= 0 && end > start)
    const component = `${source.slice(start, end)}return { handleQuantityChange }; } OrderReceiveReturnForm;`
    const submitted = []
    const errors = []
    const form = { setValue: () => {}, handleSubmit: (handler) => handler }
    const mutation = (kind) => ({
      mutateAsync: async (input) => submitted.push({ kind, input }),
    })
    const context = {
      useRouteModal: () => ({}),
      useConfirmReturnReceive: () => mutation("confirm"),
      useCancelReceiveReturn: () => mutation("cancel"),
      useAddReceiveItems: () => mutation("add"),
      useUpdateReceiveItem: () => mutation("update"),
      useRemoveReceiveItems: () => mutation("remove"),
      useStockLocation: () => ({}),
      ReceiveReturnSchema: {},
    }
    for (const token of new Set(component.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_react\d*$/u.test(token))
        context[token] = { useMemo: (read) => read(), useEffect: () => {} }
      if (/^import_react_i18next\d*$/u.test(token))
        context[token] = { useTranslation: () => ({ t: (key) => key }) }
      if (/^import_react_hook_form\d*$/u.test(token))
        context[token] = { useForm: () => form }
      if (/^import_zod\d*$/u.test(token))
        context[token] = { zodResolver: () => {} }
      if (/^import_ui\d*$/u.test(token))
        context[token] = { toast: { error: (error) => errors.push(error) } }
      if (/^useMemo\d*$/u.test(token)) context[token] = (read) => read()
      if (/^useEffect\d*$/u.test(token)) context[token] = () => {}
      if (/^useTranslation\d*$/u.test(token))
        context[token] = () => ({ t: (key) => key })
      if (/^useForm\d*$/u.test(token)) context[token] = () => form
      if (/^zodResolver\d*$/u.test(token)) context[token] = () => {}
      if (/^toast\d*$/u.test(token))
        context[token] = { error: (error) => errors.push(error) }
    }
    const item = {
      id: "ordli_fixture",
      quantity: 3,
      detail: { return_received_quantity: 0 },
      actions: [
        {
          id: "ordchact_fixture",
          action: "RECEIVE_RETURN_ITEM",
          details: { quantity: 1 },
        },
      ],
    }
    const nativeForm = vm.runInNewContext(
      component,
      context
    )({
      order: { id: "order_fixture", items: [item] },
      preview: { items: [item] },
      orderReturn: {
        id: "return_fixture",
        items: [{ item_id: item.id }],
      },
    })
    await nativeForm.handleQuantityChange(item.id, 1, 0)
    assert.equal(submitted.length, 0)
    await nativeForm.handleQuantityChange(item.id, -1, 0)
    await nativeForm.handleQuantityChange(item.id, 4, 0)
    assert.equal(submitted.length, 0)
    assert.equal(errors.length, 2)
    await nativeForm.handleQuantityChange(item.id, 2, 0)
    await nativeForm.handleQuantityChange(item.id, 0, 0)
    assert.deepEqual(JSON.parse(JSON.stringify(submitted)), [
      { kind: "update", input: { actionId: "ordchact_fixture", quantity: 2 } },
      { kind: "remove", input: "ordchact_fixture" },
    ])
  })
}

for (const [component, artifact, kind] of [
  ["ExchangeCreate", "order-create-exchange-QETUJ3ER.mjs", "exchanges"],
  ["ClaimCreate", "order-create-claim-ZMJRSB2U.mjs", "claims"],
  ["ReturnCreate", "order-create-return-CZVXDD6A.mjs", "returns"],
  ["OrderAllocateItems", "order-allocate-items-LRSTJNOD.mjs", "allocateItems"],
]) {
  for (const entry of [artifact, "app.js"]) {
    test(`${component} ${entry}: name and describe the pending native dialog`, () => {
      const ts = backendRequire("typescript")
      const source = readFileSync(join(dashboardRoot, "dist", entry), "utf8")
      const parsed = ts.createSourceFile(
        entry,
        source,
        ts.ScriptTarget.Latest,
        true
      )
      const matches = []
      const visit = (node) => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name?.getText(parsed) === component
        )
          matches.push(node)
        if (
          ts.isVariableDeclaration(node) &&
          node.name.getText(parsed) === component &&
          node.initializer &&
          ts.isArrowFunction(node.initializer)
        )
          matches.push(node.initializer)
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          node.left.getText(parsed) === component &&
          ts.isArrowFunction(node.right)
        )
          matches.push(node.right)
        ts.forEachChild(node, visit)
      }
      visit(parsed)
      assert.equal(matches.length, 1)
      const expression = matches[0].getText(parsed)
      let loaded = false
      const jsx = (type, props) => ({ type, props })
      const data = () => (loaded ? { id: "owned-fixture" } : undefined)
      const context = {
        RouteFocusModal: Object.assign(() => {}, {
          Title: "title",
          Description: "description",
        }),
        [`${component}Form`]: "native-form",
        DEFAULT_FIELDS: "id",
        useParams: () => ({ id: "owned-fixture" }),
        useNavigate: () => () => {},
        useOrder: () => ({ order: data() }),
        useOrderPreview: () => ({ order: data() }),
        useExchange: () => ({ exchange: data() }),
        useClaim: () => ({ claim: data() }),
        useReturn: () => ({ return: data() }),
        useCreateExchange: () => ({
          mutateAsync: () => assert.fail("unexpected mutation"),
        }),
        useCreateClaim: () => ({
          mutateAsync: () => assert.fail("unexpected mutation"),
        }),
        useInitiateReturn: () => ({
          mutateAsync: () => assert.fail("unexpected mutation"),
        }),
      }
      for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
        if (/^DEFAULT_FIELDS\d*$/u.test(token)) context[token] = "id"
        if (/^import_react_router_dom\d*$/u.test(token))
          context[token] = {
            useParams: context.useParams,
            useNavigate: context.useNavigate,
          }
        if (/^import_react\d*$/u.test(token))
          context[token] = {
            useState: () => [undefined, () => {}],
            useEffect: () => {},
          }
        if (/^import_react_i18next\d*$/u.test(token))
          context[token] = {
            useTranslation: () => ({
              t: (key, options) => options?.defaultValue ?? key,
            }),
          }
        if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = { jsx }
        if (/^useState\d*$/u.test(token))
          context[token] = () => [undefined, () => {}]
        if (/^useEffect\d*$/u.test(token)) context[token] = () => {}
        if (/^useTranslation\d*$/u.test(token))
          context[token] = () => ({
            t: (key, options) => options?.defaultValue ?? key,
          })
        if (/^jsx\d*$/u.test(token)) context[token] = jsx
      }
      const render = vm.runInNewContext(`(${expression})`, context)
      const pending = render().props.children
      assert.equal(pending.type, "div")
      assert.equal(pending.props.className, "sr-only")
      assert.equal(pending.props.children[0].type, "title")
      assert.equal(
        pending.props.children[0].props.children,
        `orders.${kind}.${kind === "allocateItems" ? "title" : "create"}`
      )
      assert.equal(pending.props.children[1].type, "description")
      assert.match(pending.props.children[1].props.children, /\S/u)
      loaded = true
      assert.equal(render().props.children.type, "native-form")
    })
  }
}

for (const [component, artifact] of [
  ["AddExchangeOutboundItemsTable", "order-create-exchange-QETUJ3ER.mjs"],
  ["AddClaimOutboundItemsTable", "order-create-claim-ZMJRSB2U.mjs"],
  ["AddOrderEditItemsTable", "order-create-edit-2IL2AZSQ.mjs"],
]) {
  for (const entry of [artifact, "app.js"]) {
    test(`${component} ${entry}: distinguish loading and denied reads from empty data`, () => {
      const ts = backendRequire("typescript")
      const source = readFileSync(join(dashboardRoot, "dist", entry), "utf8")
      const parsed = ts.createSourceFile(
        entry,
        source,
        ts.ScriptTarget.Latest,
        true
      )
      const matches = []
      const visit = (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === component &&
          node.initializer &&
          ts.isArrowFunction(node.initializer)
        )
          matches.push(node.initializer)
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left) &&
          node.left.text === component &&
          ts.isArrowFunction(node.right)
        )
          matches.push(node.right)
        ts.forEachChild(node, visit)
      }
      visit(parsed)
      assert.equal(matches.length, 1)
      const expression = source.slice(
        matches[0].getStart(parsed),
        matches[0].end
      )
      let query = { isPending: true, isError: false, count: 0 }
      const jsx = (type, props) => ({ type, props })
      const translation = () => ({ t: (key) => key })
      const state = (initial) => [initial, () => {}]
      const context = {
        useVariants: () => query,
        useDataTable: (options) => ({ table: options }),
        _DataTable: "native-table",
      }
      for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
        if (/^import_react\d*$/u.test(token))
          context[token] = { useState: state }
        if (/^import_react_i18next\d*$/u.test(token))
          context[token] = { useTranslation: translation }
        if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = { jsx }
        if (/^useState\d*$/u.test(token)) context[token] = state
        if (/^useTranslation\d*$/u.test(token)) context[token] = translation
        if (/^jsx\d*$/u.test(token)) context[token] = jsx
        if (/^PAGE_SIZE\d*$/u.test(token)) context[token] = 50
        if (/^PREFIX\d*$/u.test(token)) context[token] = "rit"
        if (/^use\w+Item[s]?TableQuery$/u.test(token))
          context[token] = () => ({ searchParams: {}, raw: {} })
        if (/^use\w+Item[s]?Table(?:Columns|Filters)$/u.test(token))
          context[token] = () => []
      }
      const render = vm.runInNewContext(`(${expression})`, context)
      const props = {
        selectedItems: [],
        currencyCode: "usd",
        onSelectionChange: () => {},
      }
      assert.equal(render(props).props.children.props.isLoading, true)
      const denied = Object.assign(new Error("Unauthorized"), { status: 401 })
      query = { isPending: false, isError: true, error: denied }
      assert.throws(
        () => render(props),
        (error) => error === denied
      )
      query = { isPending: false, isError: false, variants: [], count: 0 }
      const empty = render(props).props.children
      assert.equal(empty.type, "native-table")
      assert.equal(empty.props.isLoading, false)
      assert.equal(empty.props.count, 0)
    })
  }
}

for (const artifact of [
  join(dashboardRoot, "dist/chunk-OBQI23QM.mjs"),
  join(draftOrderRoot, ".medusa/server/src/admin/index.mjs"),
  join(draftOrderRoot, ".medusa/server/src/admin/index.js"),
]) {
  test(`${artifact.includes("draft-order") ? "draft-order" : "dashboard"} ${artifact.endsWith(".mjs") ? "ESM" : "CJS"}: standalone hints and mounted field references`, () => {
    const source = readFileSync(artifact, "utf8")
    const provider = artifact.endsWith("index.js")
      ? "const Provider = reactHookForm.FormProvider;"
      : artifact.includes("draft-order")
        ? "const Provider = FormProvider;"
        : "var Provider = FormProvider;"
    const start = source.indexOf(provider)
    const formSymbol = artifact.includes("draft-order") ? "Form$2" : "Form"
    const formStart = source.indexOf(
      `${formSymbol} = Object.assign(Provider`,
      start
    )
    const end = source.indexOf("\n});", formStart) + 4
    assert.ok(start >= 0 && formStart > start && end > formStart)
    const cleanups = []
    const react = {
      createContext: (value) => ({ value }),
      forwardRef: (render) => render,
      useContext: (context) => context.value,
      useEffect: (effect) => cleanups.push(effect()),
      useId: () => "field_fixture",
      useState: (initial) => [initial, () => {}],
    }
    const jsx = (type, props) => ({ type, props })
    const { Form, context } = vm.runInNewContext(
      `${source.slice(start, end)}; ({ Form: ${formSymbol}, context: FormItemContext });`,
      {
        ...react,
        React: react,
        jsx,
        jsxs: jsx,
        jsxRuntime: { jsx, jsxs: jsx },
        FormProvider: () => {},
        Controller: () => {},
        useFormContext: () => ({ getFieldState: () => ({ error: undefined }) }),
        useFormState: () => ({}),
        useTranslation: () => ({ t: (key) => key }),
        reactHookForm: {
          FormProvider: () => {},
          Controller: () => {},
          useFormContext: () => ({
            getFieldState: () => ({ error: undefined }),
          }),
          useFormState: () => ({}),
        },
        HintComponent: "hint",
        Hint$1: "hint",
        ui: { Hint: "hint", Label: "label", clx: () => "" },
        LabelComponent: "label",
        Label$1: "label",
        Slot: { Root: "slot" },
        radixUi: { Slot: { Root: "slot" } },
        clx: () => "",
      }
    )
    assert.equal(
      Form.Hint({ children: "Standalone reason hint" }).props.id,
      undefined
    )
    assert.equal(
      Form.ErrorMessage({ children: "Standalone error" }).props.id,
      undefined
    )
    assert.equal(
      Form.Label({ children: "Standalone label" }).props.htmlFor,
      undefined
    )
    assert.equal(Form.Control({}).props["aria-labelledby"], undefined)
    const changes = []
    context.value = {
      id: "field_fixture",
      hasLabel: false,
      hasHint: false,
      hasMessage: false,
      setHasLabel: (value) => changes.push(["label", value]),
      setHasHint: (value) => changes.push(["hint", value]),
      setHasMessage: (value) => changes.push(["message", value]),
    }
    assert.equal(Form.Control({}).props["aria-describedby"], undefined)
    assert.equal(Form.Hint({}).props.id, "field_fixture-form-item-description")
    assert.equal(
      Form.Label({}).props.children[0].props.id,
      "field_fixture-form-item-label"
    )
    assert.equal(
      Form.ErrorMessage({ children: "Invalid quantity" }).props.id,
      "field_fixture-form-item-message"
    )
    Object.assign(context.value, {
      hasLabel: true,
      hasHint: true,
      hasMessage: true,
    })
    const control = Form.Control({}).props
    assert.equal(control["aria-labelledby"], "field_fixture-form-item-label")
    assert.equal(
      control["aria-describedby"],
      "field_fixture-form-item-description field_fixture-form-item-message"
    )
    cleanups.forEach((cleanup) => cleanup?.())
    assert.deepEqual(changes, [
      ["hint", true],
      ["label", true],
      ["message", true],
      ["hint", false],
      ["label", false],
      ["message", false],
    ])
  })
}

test("native fulfillment rejects empty selections before its mutation", async () => {
  const dashboardRoot = dirname(
    backendRequire.resolve("@medusajs/dashboard/package.json")
  )
  const source = readFileSync(
    join(dashboardRoot, "dist/order-create-fulfillment-PQUTTGFY.mjs"),
    "utf8"
  )
  const start = source.indexOf("function OrderCreateFulfillmentForm(")
  const end = source.indexOf(
    "  return /* @__PURE__ */ jsx2(RouteFocusModal.Form",
    start
  )
  assert.ok(start >= 0 && end > start)
  const component = `${source.slice(start, end)}return { handleSubmit }; } OrderCreateFulfillmentForm;`
  const submitted = []
  const errors = []
  const form = {
    setError: (...args) => errors.push(args),
    handleSubmit: (handler) => handler,
  }
  const nativeForm = vm.runInNewContext(component, {
    useTranslation2: () => ({ t: (key) => key }),
    useRouteModal: () => ({ handleSuccess: () => {} }),
    useDocumentDirection: () => "ltr",
    useCreateOrderFulfillment: () => ({
      mutateAsync: async (data) => submitted.push(data),
      isPending: false,
    }),
    useReservationItems: () => ({ reservations: [] }),
    getReservationsLimitCount: () => 1,
    useComboboxData: () => ({}),
    useState: (read) => [read(), () => {}],
    useForm: () => form,
    zodResolver: () => {},
    CreateFulfillmentSchema: {},
    useWatch: ({ name }) =>
      name === "location_id" ? "location_fixture" : "shipping_fixture",
    useShippingOptions: () => ({
      shipping_options: [
        { id: "shipping_fixture", shipping_profile_id: "profile_fixture" },
      ],
    }),
    getFulfillableQuantity: () => 1,
    useEffect: () => {},
    toast: { success: () => {}, error: () => {} },
  })({
    order: {
      id: "order_fixture",
      items: [
        {
          id: "item_fixture",
          requires_shipping: true,
          detail: { fulfilled_quantity: 0 },
          variant: { product: { shipping_profile: { id: "profile_fixture" } } },
        },
      ],
    },
    requiresShipping: true,
  })
  for (const quantity of [{}, { item_fixture: 0 }, { unknown_item: 1 }]) {
    await nativeForm.handleSubmit({ quantity, send_notification: true })
  }
  assert.equal(submitted.length, 0)
  assert.equal(errors.length, 3)
  assert.ok(
    errors.every(
      ([field, error]) =>
        field === "root" && error.message === "orders.fulfillment.error.noItems"
    )
  )
  await nativeForm.handleSubmit({
    quantity: { item_fixture: 1 },
    send_notification: false,
  })
  assert.equal(submitted.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(submitted[0])), {
    location_id: "location_fixture",
    shipping_option_id: "shipping_fixture",
    no_notification: true,
    items: [{ id: "item_fixture", quantity: 1 }],
  })
})

test("native refund form defaults to captured remainder and blocks invalid amounts", async () => {
  const dashboardRoot = dirname(
    backendRequire.resolve("@medusajs/dashboard/package.json")
  )
  const source = readFileSync(
    join(dashboardRoot, "dist/order-create-refund-YSSM7BEM.mjs"),
    "utf8"
  )
  const start = source.indexOf("var CreateRefundForm =")
  const end = source.indexOf(
    "  return /* @__PURE__ */ jsx2(RouteDrawer.Form",
    start
  )
  assert.ok(start >= 0 && end > start)
  const component = `${source.slice(start, end)}return { form, handleSubmit, paymentAmount }; }; CreateRefundForm;`
  for (const [captures, refunds, expected] of [
    [[6.23], [], 6.23],
    [[6.23], [1], 5.23],
    [[6.23], [1, 4], 1.23],
    [[3, 2], [1], 4],
    [[6.23], [1, 4, 1.23], 0],
    [[], [], 0],
  ]) {
    const payment = {
      id: "pay_fixture",
      amount: 6.23,
      captures: captures.map((amount) => ({ amount })),
      refunds: refunds.map((amount) => ({ amount })),
    }
    const submitted = []
    const errors = []
    const values = {}
    const form = {
      setValue: (name, value) => {
        values[name] = value
      },
      setError: (...args) => errors.push(args),
      handleSubmit: (handler) => handler,
    }
    const nativeForm = vm.runInNewContext(component, {
      useTranslation2: () => ({ t: (value) => value }),
      useRouteModal: () => ({ handleSuccess: () => {} }),
      useRefundReasons: () => ({ refund_reasons: [] }),
      useSearchParams2: () => [new URLSearchParams("paymentId=pay_fixture")],
      useState2: (value) => [value, () => {}],
      getPaymentsFromOrder: () => [payment],
      useMemo2: (read) => read(),
      currencies: { USD: {} },
      useDocumentDirection: () => "ltr",
      getDecimalDigits: () => 2,
      useForm2: ({ defaultValues }) => {
        Object.assign(values, defaultValues)
        return form
      },
      zodResolver2: () => {},
      CreateRefundSchema: {},
      useEffect2: (effect) => effect(),
      useRefundPayment: () => ({
        mutateAsync: async (data) => submitted.push(data),
        isPending: false,
      }),
    })({
      order: {
        id: "order_fixture",
        currency_code: "usd",
        summary: { pending_difference: 0 },
      },
    })
    assert.equal(Number(values.amount.value), expected)
    for (const amount of [
      null,
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      expected + 0.01,
    ]) {
      await nativeForm.handleSubmit({ amount: { float: amount } })
      assert.equal(submitted.length, 0)
      assert.equal(errors.at(-1)[0], "amount")
      assert.match(errors.at(-1)[1].message, /remaining captured balance/u)
      assert.equal(errors.at(-1)[2].shouldFocus, true)
    }
    if (expected > 0) {
      await nativeForm.handleSubmit({ amount: { float: expected } })
      assert.equal(submitted.length, 1)
      assert.equal(submitted[0].amount, expected)
    }
  }
  const bundle = readFileSync(join(dashboardRoot, "dist/app.js"), "utf8")
  for (const artifact of [source, bundle]) {
    assert.match(
      artifact,
      /RouteDrawer\.Title[^\n]*orders\.payment\.createRefund/u
    )
    assert.match(artifact, /amount > maximum/u)
    assert.match(artifact, /form\.clearErrors\("amount"\)/u)
  }
  const fields = readFileSync(
    join(dashboardRoot, "dist/chunk-2UGTJ6JV.mjs"),
    "utf8"
  )
  assert.match(fields, /\*payment_collections\.payments\.captures/u)
})

const loadResolver = async (entry) => {
  const path = join(resolverRoot, "zod/dist", entry)
  if (entry === "zod.js") return resolverRequire(path).zodResolver
  if (entry === "zod.umd.js") {
    const exports = {}
    vm.runInNewContext(readFileSync(path, "utf8"), {
      exports,
      module: { exports },
      require: resolverRequire,
    })
    return exports.zodResolver
  }
  return (await import(pathToFileURL(path).href)).zodResolver
}

for (const entry of [
  "zod.js",
  "zod.mjs",
  "zod.module.js",
  "zod.modern.mjs",
  "zod.umd.js",
]) {
  test(`${entry}: native Admin validation supports both installed Zod formats`, async () => {
    const resolver = await loadResolver(entry)
    for (const z of [z3, z4]) {
      const schema = z.object({
        label: z.string().min(1, "Label required"),
        code: z.string().min(1, "Code required"),
      })
      const result = await resolver(schema)(
        { label: "", code: "" },
        undefined,
        options
      )
      assert.equal(result.errors.label.message, "Label required")
      assert.equal(result.errors.code.message, "Code required")
      assert.equal(Object.keys(result.values).length, 0)
      const valid = { label: "Audit", code: "audit" }
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(await resolver(schema)(valid, undefined, options))
        ),
        {
          errors: {},
          values: valid,
        }
      )
    }
  })
  test(`${entry}: nested Zod 4 union paths, arrays and criteria survive conversion`, async () => {
    const resolver = await loadResolver(entry)
    const schema = z4.object({
      rows: z4.array(
        z4.object({
          choice: z4.union([
            z4.object({ name: z4.string().min(1, "Name required") }),
            z4.object({ count: z4.number().min(1) }),
          ]),
        })
      ),
    })
    const result = await resolver(schema)(
      { rows: [{ choice: { name: 12 } }] },
      undefined,
      { ...options, criteriaMode: "all" }
    )
    assert.ok(result.errors.rows[0].choice.name.message)
    assert.ok(result.errors.rows[0].choice.count.message)
    const repeated = z4.object({
      label: z4.string().min(3, "Too short").regex(/^A/u, "Start with A"),
    })
    const all = await resolver(repeated)({ label: "b" }, undefined, {
      ...options,
      criteriaMode: "all",
    })
    assert.equal(all.errors.label.types.too_small, "Too short")
    assert.equal(all.errors.label.types.invalid_format, "Start with A")
    const union = z4.object({
      selection: z4.discriminatedUnion("type", [
        z4.object({ type: z4.literal("one"), name: z4.string() }),
      ]),
    })
    assert.ok(
      (
        await resolver(union)(
          { selection: { type: "other" } },
          undefined,
          options
        )
      ).errors.selection
    )
  })
  test(`${entry}: transform/raw/sync/native paths and genuine exceptions remain intact`, async () => {
    const resolver = await loadResolver(entry)
    const schema = z4.object({ label: z4.string().trim() })
    const input = { label: " Audit " }
    assert.equal(
      (await resolver(schema)(input, undefined, options)).values.label,
      "Audit"
    )
    assert.equal(
      (
        await resolver(schema, undefined, { raw: true, mode: "sync" })(
          input,
          undefined,
          options
        )
      ).values.label,
      input.label
    )
    let validity
    let reports = 0
    const ref = {
      setCustomValidity: (value) => {
        validity = value
      },
      reportValidity: () => {
        reports += 1
      },
    }
    const native = {
      fields: { label: { ref } },
      shouldUseNativeValidation: true,
    }
    const required = z4.object({ label: z4.string().min(1, "Label required") })
    await resolver(required)({ label: "" }, undefined, native)
    assert.equal(validity, "Label required")
    await resolver(required)({ label: "Audit" }, undefined, native)
    assert.equal(validity, "")
    assert.equal(reports, 2)
    for (const failure of [new Error("Unexpected"), null, { issues: [] }]) {
      await assert.rejects(
        resolver({
          parseAsync: async () => {
            throw failure
          },
        })({}, undefined, options),
        (error) => error === failure
      )
    }
  })
}
