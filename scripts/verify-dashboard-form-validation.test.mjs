import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
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
const uiRoot = join(dirname(backendRequire.resolve("@medusajs/ui")), "../..")

const unboundNativeJsxCalls = (entry, source) => {
  const ts = backendRequire("typescript")
  const parsed = ts.createSourceFile(
    entry,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const imported = new Set()
  for (const node of parsed.statements) {
    if (!ts.isImportDeclaration(node)) continue
    if (node.importClause?.name) imported.add(node.importClause.name.text)
    const bindings = node.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) imported.add(binding.name.text)
    }
  }
  const missing = new Set()
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(?:jsx|jsxs)\d*$/u.test(node.expression.text) &&
      !imported.has(node.expression.text)
    ) {
      missing.add(node.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return [...missing].sort()
}

test("native JSX binding check rejects a missing multi-child helper", () => {
  const missing =
    'import { jsx as jsx2 } from "react/jsx-runtime"; jsxs2(Dialog, {});'
  assert.deepEqual(unboundNativeJsxCalls("missing.mjs", missing), ["jsxs2"])
  const bound =
    'import { jsxs as jsxs2 } from "react/jsx-runtime"; jsxs2(Dialog, {});'
  assert.deepEqual(unboundNativeJsxCalls("bound.mjs", bound), [])
})

test("every shipped native Admin ESM bundle imports its JSX helpers", () => {
  const entries = readdirSync(join(dashboardRoot, "dist")).filter((entry) =>
    entry.endsWith(".mjs")
  )
  assert(entries.length > 0)
  for (const entry of entries) {
    assert.deepEqual(
      unboundNativeJsxCalls(
        entry,
        readFileSync(join(dashboardRoot, "dist", entry), "utf8")
      ),
      [],
      `${entry} has an unbound JSX runtime helper`
    )
  }
})

const nativeArrow = (entry, name, root = dashboardRoot) => {
  const ts = backendRequire("typescript")
  const source = readFileSync(join(root, "dist", entry), "utf8")
  const parsed = ts.createSourceFile(
    entry,
    source,
    ts.ScriptTarget.Latest,
    true
  )
  const matches = []
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(parsed) === name)
      matches.push(node)
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(parsed) === name &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    )
      matches.push(node.initializer)
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(parsed) === name &&
      ts.isArrowFunction(node.right)
    )
      matches.push(node.right)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(matches.length, 1)
  return matches[0].getText(parsed)
}

const nativeMenuHarness = (
  distribution,
  component,
  instance,
  overrides = {}
) => {
  const expression = nativeArrow(
    `${distribution}/blocks/data-table/components/data-table-${component}.js`,
    component === "action-cell"
      ? "DataTableActionCell"
      : component === "filter"
        ? "DataTableFilter"
        : component === "filter-menu"
          ? "DataTableFilterMenu"
          : "DataTableSortingMenu",
    uiRoot
  )
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...props, children: children.flat() },
  })
  const react = {
    createElement,
    Fragment: "fragment",
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useState: (value) => [value, () => {}],
  }
  const dropdown = Object.assign(() => {}, {
    Trigger: "trigger",
    Content: "content",
    Item: "item",
    RadioGroup: "radio-group",
    RadioItem: "radio-item",
    Separator: "separator",
  })
  const popover = Object.assign(() => {}, {
    Trigger: "value-trigger",
    Content: "popover-content",
    Anchor: "anchor",
  })
  const useDataTableContext = () => ({ instance })
  return vm.runInNewContext(`(${expression})`, {
    React: react,
    react_1: react,
    DropdownMenu: dropdown,
    dropdown_menu_1: { DropdownMenu: dropdown },
    Popover: popover,
    popover_1: { Popover: popover },
    IconButton: "icon-button",
    icon_button_1: { IconButton: "icon-button" },
    Tooltip: "tooltip",
    tooltip_1: { Tooltip: "tooltip" },
    Funnel: "funnel",
    DescendingSorting: "sort",
    ArrowUpMini: "up",
    ArrowDownMini: "down",
    XMark: "remove",
    EllipsisHorizontal: "ellipsis",
    icons_1: {
      Funnel: "funnel",
      DescendingSorting: "sort",
      ArrowUpMini: "up",
      ArrowDownMini: "down",
      XMark: "remove",
      EllipsisHorizontal: "ellipsis",
    },
    useDataTableContext,
    use_data_table_context_1: { useDataTableContext },
    DataTableFilterMenuSkeleton: "filter-skeleton",
    DataTableSortingMenuSkeleton: "sort-skeleton",
    DataTableFilterRadioContent: "radio-content",
    getSortLabel: (column) => column.id,
    getSortDescriptor: (direction) => direction,
    isDateComparisonOperator: () => false,
    is_date_comparison_operator_1: { isDateComparisonOperator: () => false },
    clx: (...classes) =>
      classes.filter((value) => typeof value === "string").join(" "),
    clx_1: {
      clx: (...classes) =>
        classes.filter((value) => typeof value === "string").join(" "),
    },
    ...overrides,
  })
}

const menuNodes = (tree, type) => {
  if (!tree || typeof tree !== "object") return []
  return [
    ...(tree.type === type ? [tree] : []),
    ...[tree.props?.children ?? []]
      .flat(Infinity)
      .flatMap((child) => menuNodes(child, type)),
  ]
}

for (const distribution of ["esm", "cjs"]) {
  test(`${distribution}: native toast has an accessible exact-ID dismiss action`, () => {
    const expression = nativeArrow(
      `${distribution}/components/toast/toast.js`,
      "Toast",
      uiRoot
    )
    const dismissed = []
    const toast = { dismiss: (id) => dismissed.push(id) }
    const icons = Object.fromEntries(
      [
        "CheckCircleSolid",
        "ExclamationCircleSolid",
        "InformationCircleSolid",
        "Spinner",
        "XCircleSolid",
        "XMark",
      ].map((name) => [name, name])
    )
    const clx = (...classes) =>
      classes.filter((value) => typeof value === "string").join(" ")
    const render = vm.runInNewContext(`(${expression})`, {
      React: {
        createElement: (type, props, ...children) => ({
          type,
          props: { ...props, children: children.flat() },
        }),
      },
      ...icons,
      icons_1: icons,
      IconButton: "icon-button",
      icon_button_1: { IconButton: "icon-button" },
      toast,
      sonner_1: { toast },
      clx,
      clx_1: { clx },
    })
    let actionCalls = 0
    const props = {
      id: "owned-notification-id",
      title: "Saved",
      variant: "success",
      action: { label: "Review", onClick: () => actionCalls++ },
    }
    const tree = render(props)
    const close = menuNodes(tree, "icon-button")
    assert.equal(close.length, 1)
    assert.equal(close[0].props["aria-label"], "Dismiss notification")
    assert.equal(close[0].props.size, "xsmall")
    assert.equal(close[0].props.type, "button")
    assert.equal(close[0].props.variant, "transparent")
    close[0].props.onClick()
    assert.deepEqual(dismissed, ["owned-notification-id"])
    assert.equal(actionCalls, 0)
    const action = menuNodes(tree, "button")
    assert.equal(action.length, 1)
    action[0].props.onClick()
    assert.equal(actionCalls, 1)
    assert.deepEqual(dismissed, ["owned-notification-id"])
    assert.equal(
      menuNodes(render({ ...props, dismissable: false }), "icon-button").length,
      0
    )
  })

  test(`${distribution}: native row actions retain exact row and event boundaries`, () => {
    let seen
    let stopped = false
    const ctx = {
      column: {
        columnDef: {
          meta: {
            ___actions: (row) => [
              {
                label: "Edit",
                onClick: (value) => {
                  seen = value
                },
              },
            ],
          },
        },
      },
      row: { original: { id: "variant_owned" } },
    }
    const cell = nativeMenuHarness(distribution, "action-cell", {})
    const tree = cell({ ctx })
    const trigger = menuNodes(tree, "icon-button")[0].props
    assert.equal(trigger["aria-label"], "Open row actions")
    assert.equal(trigger.style.minWidth, 24)
    assert.equal(trigger.style.minHeight, 24)
    assert.equal(trigger.style.flexShrink, 0)
    menuNodes(tree, "item")[0].props.onClick({
      stopPropagation: () => {
        stopped = true
      },
    })
    assert.equal(stopped, true)
    assert.equal(seen, ctx)
    assert.equal(cell({ ctx: { column: { columnDef: { meta: {} } } } }), null)
  })

  test(`${distribution}: native filter menu retains localized names, targets and filtering callbacks`, () => {
    let filtering = {}
    const additions = []
    const instance = {
      getFiltering: () => filtering,
      getFilters: () => [
        { id: "managed", label: "Manage inventory", type: "radio" },
      ],
      addFilter: (filter) => additions.push(filter),
    }
    const menu = nativeMenuHarness(distribution, "filter-menu", instance)
    for (const tooltip of [
      "Filter",
      "Filtern",
      undefined,
      "   ",
      { label: "Filter" },
    ]) {
      const tree = menu({ tooltip })
      const trigger = menuNodes(tree, "icon-button")[0].props
      assert.equal(
        trigger["aria-label"],
        typeof tooltip === "string" && tooltip.trim()
          ? tooltip
          : "Filter results"
      )
      assert.equal(trigger.style.minWidth, 24)
      assert.equal(trigger.style.minHeight, 24)
      assert.equal(trigger.style.flexShrink, 0)
      assert.equal(trigger.style.cursor, "pointer")
    }
    let stopped = false
    menuNodes(menu({}), "item")[0].props.onClick({
      stopPropagation: () => {
        stopped = true
      },
    })
    assert.equal(stopped, true)
    assert.deepEqual(JSON.parse(JSON.stringify(additions)), [
      { id: "managed", value: null },
    ])
    let custom
    menuNodes(
      menu({
        onAddFilter: (...args) => {
          custom = args
        },
      }),
      "item"
    )[0].props.onClick({ stopPropagation: () => {} })
    assert.deepEqual(custom, ["managed", null])
    filtering = { managed: "true" }
    assert.equal(menuNodes(menu({}), "trigger")[0].props.disabled, true)
    instance.showSkeleton = true
    assert.equal(menu({}).type, "filter-skeleton")
  })

  test(`${distribution}: native sorting menu retains direction and selection semantics`, () => {
    let sorting = { id: "title", desc: true }
    const instance = {
      enableSorting: true,
      getAllColumns: () => [
        { id: "title", getCanSort: () => true },
        { id: "created_at", getCanSort: () => true },
      ],
      getSorting: () => sorting,
      setSorting: (update) => {
        sorting = update(sorting)
      },
    }
    const menu = nativeMenuHarness(distribution, "sorting-menu", instance)
    for (const tooltip of [
      "Sort",
      "Sortieren",
      undefined,
      "",
      { label: "Sort" },
    ]) {
      const trigger = menuNodes(menu({ tooltip }), "icon-button")[0].props
      assert.equal(
        trigger["aria-label"],
        typeof tooltip === "string" && tooltip.trim() ? tooltip : "Sort results"
      )
      assert.equal(trigger.style.flexShrink, 0)
      assert.equal(trigger.style.minWidth, 24)
      assert.equal(trigger.style.minHeight, 24)
    }
    const groups = menuNodes(menu({}), "radio-group")
    groups[0].props.onValueChange("created_at")
    assert.deepEqual(JSON.parse(JSON.stringify(sorting)), {
      id: "created_at",
      desc: true,
    })
    groups[1].props.onValueChange("false")
    assert.deepEqual(JSON.parse(JSON.stringify(sorting)), {
      id: "created_at",
      desc: false,
    })
    instance.showSkeleton = true
    assert.equal(menu({}).type, "sort-skeleton")
    instance.enableSorting = false
    assert.throws(() => menu({}), /sorting is not enabled/)
  })

  test(`${distribution}: named individual filter removal preserves native close focus and callbacks`, () => {
    const removed = []
    const instance = {
      getFilterMeta: () => ({
        type: "radio",
        label: "Inventar verwalten",
        options: [{ value: "true", label: "Ja" }],
      }),
      removeFilter: (id) => removed.push(id),
    }
    const filter = nativeMenuHarness(distribution, "filter", instance)
    const tree = filter({
      id: "managed",
      filter: "true",
      removeFilterLabel: "Entfernen",
    })
    const remove = menuNodes(tree, "button").find(
      (node) => node.props["aria-label"]
    )
    assert.equal(remove.props["aria-label"], "Entfernen: Inventar verwalten")
    assert.equal(remove.props.style.flexShrink, 0)
    assert.equal(remove.props.style.minWidth, 24)
    assert.equal(remove.props.style.minHeight, 24)
    assert.ok(
      remove.props.className.includes("focus-visible:shadow-borders-focus")
    )
    remove.props.onClick()
    assert.deepEqual(removed, ["managed"])
    let prevented = false
    menuNodes(tree, "popover-content")[0].props.onCloseAutoFocus({
      preventDefault: () => {
        prevented = true
      },
    })
    assert.equal(prevented, false)
    menuNodes(
      filter({ id: "managed", filter: null, isNew: true }),
      "popover-content"
    )[0].props.onCloseAutoFocus({
      preventDefault: () => {
        prevented = true
      },
    })
    assert.equal(prevented, true)
    let customRemoved = false
    const custom = filter({
      id: "managed",
      filter: "true",
      onRemove: () => {
        customRemoved = true
      },
    })
    menuNodes(custom, "button")
      .find((node) => node.props["aria-label"])
      .props.onClick()
    assert.equal(customRemoved, true)
    assert.equal(removed.length, 1)
  })
}

for (const distribution of ["esm", "cjs"]) {
  test(`${distribution}: native table search preserves values, naming and caller overrides`, () => {
    const expression = nativeArrow(
      `${distribution}/blocks/data-table/components/data-table-search.js`,
      "DataTableSearch",
      uiRoot
    )
    let value = "vinyl"
    const instance = {
      enableSearch: true,
      showSkeleton: false,
      isLoading: true,
      getSearch: () => value,
      onSearchChange: (next) => {
        value = next
      },
    }
    const clx = backendRequire("@medusajs/ui").clx
    const search = vm.runInNewContext(`(${expression})`, {
      React: { createElement: (type, props) => ({ type, props }) },
      Input: "input",
      input_1: { Input: "input" },
      clx,
      clx_1: { clx },
      useDataTableContext: () => ({ instance }),
      use_data_table_context_1: { useDataTableContext: () => ({ instance }) },
      DataTableSearchSkeleton: "search-skeleton",
    })
    const input = search({ placeholder: "Suchen", "data-owned": "fixture" })
    assert.equal(input.type, "input")
    assert.equal(input.props.value, "vinyl")
    assert.equal(input.props["aria-label"], "Suchen")
    assert.equal(input.props["data-owned"], "fixture")
    input.props.onChange({ target: { value: "CD • cassette" } })
    assert.equal(value, "CD • cassette")
    assert.equal(search({}).props.value, value)
    input.props.onChange({ target: { value: "" } })
    assert.equal(value, "")
    const supplied = search({
      "aria-label": "Owned search",
      className: "placeholder-ui-fg-base",
    })
    assert.equal(supplied.props["aria-label"], "Owned search")
    assert.ok(supplied.props.className.includes("placeholder-ui-fg-base"))
    assert.equal(
      supplied.props.className.includes("placeholder-ui-fg-subtle"),
      false
    )
    instance.showSkeleton = true
    assert.equal(search({}).type, "search-skeleton")
    instance.enableSearch = false
    assert.throws(() => search({}), /search is not enabled/)
  })
}

for (const entry of ["chunk-OZPB6JBL.mjs", "components.js", "app.js"]) {
  test(`${entry}: default action trigger is named and supplied children retain ownership`, () => {
    const expression = nativeArrow(entry, "ActionMenu")
    const jsx = (type, props) => ({ type, props })
    const dropdown = Object.assign(() => {}, {
      Trigger: "trigger",
      Content: "content",
      Group: "group",
      Item: "item",
      Separator: "separator",
    })
    const context = {
      jsx,
      jsxs: jsx,
      IconButton: "icon-button",
      DropdownMenu: dropdown,
      EllipsisHorizontal: "ellipsis",
      Link: "link",
      useDocumentDirection: () => "ltr",
      clx: () => "actions",
      ConditionalTooltip: "tooltip",
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
      if (/^import_ui\d*$/u.test(token))
        context[token] = {
          IconButton: "icon-button",
          DropdownMenu: dropdown,
          clx: context.clx,
        }
      if (/^import_icons\d*$/u.test(token))
        context[token] = { EllipsisHorizontal: "ellipsis" }
    }
    const menu = vm.runInNewContext(`(${expression})`, context)
    const trigger = menuNodes(menu({ groups: [] }), "icon-button")[0].props
    assert.equal(trigger["aria-label"], "Open actions")
    assert.equal(trigger.style.minWidth, 24)
    assert.equal(trigger.style.minHeight, 24)
    assert.equal(trigger.style.flexShrink, 0)
    const supplied = { type: "owned-trigger", props: {} }
    assert.equal(
      menuNodes(menu({ groups: [], children: supplied }), "trigger")[0].props
        .children,
      supplied
    )
    let clicked = false
    let stopped = false
    const action = menuNodes(
      menu({
        groups: [
          {
            actions: [
              {
                label: "Edit",
                onClick: () => {
                  clicked = true
                },
              },
            ],
          },
        ],
      }),
      "item"
    )[0]
    action.props.onClick({
      stopPropagation: () => {
        stopped = true
      },
    })
    assert.equal(clicked, true)
    assert.equal(stopped, true)
  })
}

for (const entry of ["chunk-QIJSUXW3.mjs", "app.js"]) {
  test(`${entry}: mobile navigation close is localized and retains native state`, () => {
    const expression = nativeArrow(entry, "MobileSidebarContainer")
    const jsx = (type, props) => ({ type, props })
    const dialog = {
      Root: "dialog-root",
      Portal: "dialog-portal",
      Overlay: "dialog-overlay",
      Content: "dialog-content",
      Close: "dialog-close",
      Title: "dialog-title",
      Description: "dialog-description",
    }
    const calls = []
    const focusCalls = []
    let triggerWidth = 28
    const trigger = {
      getBoundingClientRect: () => ({ width: triggerWidth }),
      focus: (options) => focusCalls.push(options),
    }
    const translate = (key) =>
      ({
        "actions.close": "Localized Close",
        "app.nav.accessibility.title": "Localized Navigation",
      })[key] ?? key
    const clx = (...classes) => classes.join(" ")
    const context = {
      useSidebar: () => ({
        mobile: true,
        toggle: (value) => calls.push(value),
      }),
      RadixDialog2: dialog,
      XMark: "close-icon",
      import_radix_ui3: { Dialog: dialog },
      document: {
        querySelector: (selector) => {
          assert.equal(
            selector,
            'button[data-medusa-navigation-toggle="mobile"]'
          )
          return trigger
        },
      },
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^jsx\d*$/u.test(token) || /^jsxs\d*$/u.test(token))
        context[token] = jsx
      if (/^useTranslation\d*$/u.test(token))
        context[token] = () => ({ t: translate })
      if (/^clx\d*$/u.test(token)) context[token] = clx
      if (/^IconButton\d*$/u.test(token)) context[token] = "icon-button"
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
      if (/^import_react_i18next\d*$/u.test(token))
        context[token] = { useTranslation: () => ({ t: translate }) }
      if (/^import_ui\d*$/u.test(token))
        context[token] = { IconButton: "icon-button", clx }
      if (/^import_icons\d*$/u.test(token))
        context[token] = { XMark: "close-icon" }
    }
    const tree = vm.runInNewContext(
      `(${expression})`,
      context
    )({ children: "owned-navigation" })
    const close = menuNodes(tree, "icon-button")[0]
    assert.equal(
      close.props["aria-label"],
      "Localized Close Localized Navigation"
    )
    assert.equal(menuNodes(tree, "dialog-close")[0].props.asChild, true)
    assert.equal(tree.props.open, true)
    tree.props.onOpenChange(false)
    assert.deepEqual(calls, ["mobile"])
    let prevented = 0
    const onCloseAutoFocus = menuNodes(tree, "dialog-content")[0].props
      .onCloseAutoFocus
    onCloseAutoFocus({
      preventDefault: () => {
        prevented += 1
      },
    })
    assert.equal(prevented, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(focusCalls)), [
      { preventScroll: true },
    ])
    triggerWidth = 0
    onCloseAutoFocus({
      preventDefault: () => {
        prevented += 1
      },
    })
    assert.equal(prevented, 1)
    assert.equal(focusCalls.length, 1)
  })
  test(`${entry}: native topbar supplies the banner without changing its controls`, () => {
    const expression = nativeArrow(entry, "Topbar")
    const jsx = (type, props) => ({ type, props })
    const context = { jsx, jsxs: jsx }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^jsx\d*$/u.test(token) || /^jsxs\d*$/u.test(token))
        context[token] = jsx
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
    }
    for (const component of [
      "ToggleSidebar",
      "Breadcrumbs",
      "CustomizerMenu",
      "LayoutCustomizerSlot",
      "Notifications",
    ])
      context[component] = component
    context.LayoutComposer = Object.assign("composer", {
      Entry: "composer-entry",
    })
    context.LAYOUT_CONTROLS_LOCATION = "topbar"
    context.CORE_LAYOUT_IDS = { SINGLE_ROW: "single-row" }
    context.import_admin_shared = { CORE_LAYOUT_IDS: context.CORE_LAYOUT_IDS }
    context.CUSTOMIZE_IDS = { TOPBAR: "topbar" }
    const topbar = vm.runInNewContext(`(${expression})`, context)()
    assert.equal(topbar.type, "header")
    assert.equal(menuNodes(topbar, "ToggleSidebar").length, 1)
    assert.equal(menuNodes(topbar, "Breadcrumbs").length, 1)
    assert.equal(
      menuNodes(topbar, context.LayoutComposer)[0].props.sections.main.props
        .children.type,
      "Notifications"
    )
  })
  test(`${entry}: responsive navigation controls retain their native sidebar action`, () => {
    const expression = nativeArrow(entry, "ToggleSidebar")
    const jsx = (type, props) => ({ type, props })
    const calls = []
    const context = {
      jsx,
      jsxs: jsx,
      useSidebar: () => ({ toggle: (surface) => calls.push(surface) }),
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^jsx\d*$/u.test(token) || /^jsxs\d*$/u.test(token))
        context[token] = jsx
      if (/^IconButton\d*$/u.test(token)) context[token] = "icon-button"
      if (/^SidebarLeft\d*$/u.test(token)) context[token] = "sidebar-icon"
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
      if (/^import_ui\d*$/u.test(token))
        context[token] = { IconButton: "icon-button" }
      if (/^import_icons\d*$/u.test(token))
        context[token] = { SidebarLeft: "sidebar-icon" }
    }
    const sidebar = vm.runInNewContext(`(${expression})`, context)
    const triggers = menuNodes(sidebar(), "icon-button")
    assert.equal(triggers.length, 2)
    for (const trigger of triggers) {
      assert.equal(trigger.props["aria-label"], "Toggle navigation")
      trigger.props.onClick()
    }
    assert.equal(triggers[0].props["data-medusa-navigation-toggle"], undefined)
    assert.equal(triggers[1].props["data-medusa-navigation-toggle"], "mobile")
    assert.deepEqual(calls, ["desktop", "mobile"])
  })
}

for (const distribution of ["esm", "cjs"]) {
  test(`${distribution}: native action header retains caller overrides and row context`, () => {
    const expression = nativeArrow(
      `${distribution}/blocks/data-table/utils/create-data-table-column-helper.js`,
      "createDataTableColumnHelper",
      uiRoot
    )
    const createElement = (type, props, ...children) => ({
      type,
      props: { ...props, children },
    })
    const createColumnHelper = () => ({
      accessor: (accessor, props) => ({ accessor, ...props }),
      display: (props) => props,
    })
    const helper = vm.runInNewContext(`(${expression})`, {
      React: { createElement },
      createColumnHelperTanstack: createColumnHelper,
      react_table_1: { createColumnHelper },
      DataTableActionCell: "action-cell",
      data_table_action_cell_1: { DataTableActionCell: "action-cell" },
    })()
    const actions = [{ label: "Owned action", onClick: () => {} }]
    const column = helper.action({ actions })
    assert.equal(column.id, "action")
    assert.equal(column.header().type, "span")
    assert.equal(column.header().props.className, "sr-only")
    assert.equal(column.header().props.children[0], "Actions")
    assert.equal(column.meta.___actions, actions)
    const ctx = { row: { original: { id: "owned-row" } } }
    assert.equal(column.cell(ctx).props.ctx, ctx)
    const suppliedHeader = () => "Localized actions"
    assert.equal(
      helper.action({ actions, header: suppliedHeader }).header,
      suppliedHeader
    )
  })
  test(`${distribution}: column menu has a name and retains its target width`, () => {
    const expression = nativeArrow(
      `${distribution}/blocks/data-table/components/data-table-column-visibility-menu.js`,
      "DataTableColumnVisibilityMenu",
      uiRoot
    )
    let enabled = true
    const createElement = (type, props, ...children) => ({
      type,
      props: { ...props, children },
    })
    const react = { createElement, Fragment: "fragment" }
    const dropdown = Object.assign("dropdown", {
      Trigger: "trigger",
      Content: "content",
      Label: "label",
      Separator: "separator",
      Item: "item",
    })
    const useDataTableContext = () => ({
      enableColumnVisibility: enabled,
      instance: { getAllColumns: () => [] },
    })
    const menu = vm.runInNewContext(`(${expression})`, {
      React: react,
      react_1: { default: react },
      Checkbox: "checkbox",
      checkbox_1: { Checkbox: "checkbox" },
      DropdownMenu: dropdown,
      dropdown_menu_1: { DropdownMenu: dropdown },
      IconButton: "icon-button",
      icon_button_1: { IconButton: "icon-button" },
      Tooltip: "tooltip",
      tooltip_1: { Tooltip: "tooltip" },
      Adjustments: "adjustments",
      icons_1: { Adjustments: "adjustments" },
      useDataTableContext,
      use_data_table_context_1: { useDataTableContext },
    })
    for (const tooltip of ["Choose columns", undefined, { type: "label" }]) {
      const rendered = menu({ tooltip, className: "custom" })
      const trigger =
        rendered.props.children[0].props.children[0].props.children[0]
      assert.equal(trigger.type, "icon-button")
      assert.equal(
        trigger.props["aria-label"],
        typeof tooltip === "string" ? tooltip : "Toggle columns"
      )
      assert.equal(trigger.props.className, "custom")
      assert.equal(trigger.props.style.minWidth, 24)
      assert.equal(trigger.props.style.minHeight, 24)
      assert.equal(trigger.props.style.flexShrink, 0)
      assert.equal(trigger.props.style.cursor, "pointer")
    }
    enabled = false
    assert.equal(menu({}), null)
  })
}

for (const entry of ["chunk-3DUKCSX3.mjs", "app.js"]) {
  test(`${entry}: order number is a native router link with a plain fallback`, () => {
    const expression = nativeArrow(entry, "DisplayIdCell")
    const jsx = (type, props) => ({ type, props })
    const context = {
      PlaceholderCell: "placeholder",
      rrOrderLink: "router-link",
      rrOrderLinkRouter: { Link: "router-link" },
      jsx,
      jsxs: jsx,
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
    }
    const cell = vm.runInNewContext(`(${expression})`, context)
    const linked = cell({ displayId: 10, orderId: "order_owned" }).props
      .children
    assert.equal(linked.type, "router-link")
    assert.equal(linked.props.to, "/orders/order_owned")
    assert.ok(linked.props.className.includes("rr-native-order-link"))
    assert.deepEqual(JSON.parse(JSON.stringify(linked.props.children)), [
      "#",
      10,
    ])
    let stopped = false
    linked.props.onClick({
      stopPropagation: () => {
        stopped = true
      },
    })
    assert.equal(stopped, true)
    assert.equal(cell({ displayId: 10 }).props.children.type, "span")
    assert.equal(cell({ orderId: "order_owned" }).type, "placeholder")
  })
}

for (const entry of ["chunk-IHA2XWHD.mjs", "app.js"]) {
  test(`${entry}: configurable display-id links are confined to orders`, () => {
    const expression = nativeArrow(entry, "DisplayIdRenderer")
    const jsx = (type, props) => ({ type, props })
    const context = {
      DisplayIdCell: "display-id-cell",
      jsx,
      useMemo: (factory) => factory(),
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = { jsx }
      if (/^jsx\d*$/u.test(token)) context[token] = jsx
      if (/^import_react\d*$/u.test(token))
        context[token] = { useMemo: context.useMemo }
      if (/^columnHelper\d*$/u.test(token))
        context[token] = {
          accessor: (_field, column) => column,
          display: (column) => column,
        }
    }
    const renderer = vm.runInNewContext(`(${expression})`, context)
    const rendered = renderer(
      10,
      { id: "order_owned", status: "pending" },
      {},
      () => {}
    )
    assert.equal(rendered.type, "display-id-cell")
    assert.equal(rendered.props.orderId, "order_owned")
    assert.equal(rendered.props.displayId, 10)
    for (const row of [
      { id: "other_owned" },
      { id: "order_owned", status: "draft" },
      {},
    ]) {
      assert.equal(renderer(10, row, {}, () => {}).props.orderId, undefined)
    }
  })
}

for (const entry of ["order-receive-return-HEIGUW3S.mjs", "app.js"]) {
  for (const [name, items, expected] of [
    [
      "fresh receipt",
      [{ item_id: "fresh", quantity: 3 }],
      [{ id: "fresh", quantity: 3 }],
    ],
    [
      "split receipt",
      [{ item_id: "split", quantity: 2, received_quantity: 1 }],
      [{ id: "split", quantity: 1 }],
    ],
    [
      "damaged units included in received total",
      [
        {
          item_id: "damaged",
          quantity: 2,
          received_quantity: 1,
          damaged_quantity: 1,
        },
      ],
      [{ id: "damaged", quantity: 1 }],
    ],
    [
      "mixed complete and pending lines",
      [
        { item_id: "complete", quantity: 2, received_quantity: 2 },
        { item_id: "pending", quantity: 3, received_quantity: 1 },
      ],
      [{ id: "pending", quantity: 2 }],
    ],
    [
      "complete receipt",
      [{ item_id: "complete", quantity: 2, received_quantity: 2 }],
      [],
    ],
  ]) {
    test(`${entry}: initialize ${name} with only remaining units`, async () => {
      const source = readFileSync(join(dashboardRoot, "dist", entry), "utf8")
      const start = source.indexOf("function OrderReceiveReturn() {")
      const end = source.indexOf("  const ready =", start)
      assert.ok(start >= 0 && end > start)
      const component = `${source.slice(start, end)}return null; } OrderReceiveReturn;`
      const effects = []
      const submissions = []
      const errors = []
      let initiated = 0
      const context = {
        Error,
        useParams: () => ({ id: "order_owned", return_id: "return_owned" }),
        useNavigate: () => () => assert.fail("unexpected redirect"),
        useOrder: () => ({ order: { id: "order_owned" } }),
        useOrderPreview: () => ({ order: {} }),
        useReturn: () => ({ return: { id: "return_owned", items } }),
        useInitiateReceiveReturn: () => ({
          mutateAsync: async (input) => {
            assert.deepEqual(JSON.parse(JSON.stringify(input)), {})
            initiated += 1
            return { return: { id: "return_owned", items } }
          },
        }),
        useAddReceiveItems: () => ({
          mutateAsync: async (input) => {
            submissions.push(JSON.parse(JSON.stringify(input)))
          },
        }),
      }
      for (const token of new Set(component.match(/[A-Za-z_]\w*/gu))) {
        if (/^IS_REQUEST_RUNNING\d*$/u.test(token)) context[token] = false
        if (/^import_react_router_dom\d*$/u.test(token))
          context[token] = {
            useParams: context.useParams,
            useNavigate: context.useNavigate,
          }
        if (/^import_react\d*$/u.test(token))
          context[token] = {
            useEffect: (effect) => effects.push(effect),
          }
        if (/^import_react_i18next\d*$/u.test(token))
          context[token] = {
            useTranslation: () => ({ t: (key) => key }),
          }
        if (/^import_ui\d*$/u.test(token))
          context[token] = {
            toast: { error: (error) => errors.push(error) },
          }
        if (/^useEffect\d*$/u.test(token))
          context[token] = (effect) => effects.push(effect)
        if (/^useTranslation\d*$/u.test(token))
          context[token] = () => ({ t: (key) => key })
        if (/^toast\d*$/u.test(token))
          context[token] = { error: (error) => errors.push(error) }
      }
      vm.runInNewContext(component, context)()
      assert.equal(effects.length, 1)
      effects[0]()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(initiated, 1)
      assert.deepEqual(errors, [])
      assert.deepEqual(
        submissions,
        expected.length ? [{ items: expected }] : []
      )
    })
  }
}

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
        : "var Provider = "
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

// Execute the shipped same-version Settings columns, including native callbacks.
for (const [artifact, cjsName, kind, preselected] of [
  ["store-detail-O2LT2IJI.mjs", "useColumns35", "currency", false],
  ["store-add-currencies-A5YJXATX.mjs", "useColumns37", "currency", true],
  ["region-detail-ZIUJ5MDA.mjs", "useColumns33", "country", false],
  ["region-add-countries-GYOE3HWN.mjs", "useColumns34", "country", true],
  ["region-create-UOKF5UOS.mjs", "useColumns32", "country", true],
]) {
  for (const entry of [artifact, "app.js"]) {
    test(`${artifact} ${entry}: identified native selection preserves page and disabled state`, () => {
      const expression = nativeArrow(
        entry,
        entry === "app.js" ? cjsName : "useColumns"
      )
      const jsx = (type, props) => ({ type, props })
      const helper = {
        display: (props) => props,
        accessor: (_field, props) => props,
      }
      const translate = (key) =>
        key === "general.selectAll"
          ? "Select all"
          : key === "actions.select"
            ? "Select"
            : key
      const context = {
        useCurrenciesTableColumns: () => [],
        useCountryTableColumns: () => [],
        columnHelper: helper,
        useTranslation: () => ({ t: translate }),
        useMemo: (factory) => factory(),
        Checkbox: "checkbox",
        Tooltip: "tooltip",
        jsx,
        jsxs: jsx,
      }
      for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
        if (/^columnHelper\d*$/u.test(token)) context[token] = helper
        if (/^useTranslation\d*$/u.test(token))
          context[token] = context.useTranslation
        if (/^jsx\d*$/u.test(token) || /^jsxs\d*$/u.test(token))
          context[token] = jsx
        if (/^import_jsx_runtime\d*$/u.test(token))
          context[token] = { jsx, jsxs: jsx }
        if (/^import_ui\d*$/u.test(token))
          context[token] = { Checkbox: "checkbox", Tooltip: "tooltip" }
        if (/^import_react\d*$/u.test(token))
          context[token] = { useMemo: context.useMemo }
        if (/^import_react_i18next\d*$/u.test(token))
          context[token] = { useTranslation: context.useTranslation }
      }
      const columns = vm.runInNewContext(`(${expression})`, context)(
        {},
        () => {},
        () => {}
      )
      const select = columns.find((column) => column.id === "select")
      if (!preselected) {
        const actions = columns.find((column) => column.id === "actions")
        const header = actions.header()
        assert.equal(header.type, "span")
        assert.equal(header.props.className, "sr-only")
        assert.equal(header.props.children, "fields.actions")
      }
      const calls = []
      const header = select.header({
        table: {
          getIsSomePageRowsSelected: () => true,
          getIsAllPageRowsSelected: () => false,
          toggleAllPageRowsSelected: (value) => calls.push(["page", value]),
        },
      })
      assert.equal(header.props["aria-label"], "Select all")
      assert.equal(header.props.checked, "indeterminate")
      assert.match(header.props.className, /min-h-6 min-w-6/u)
      header.props.onCheckedChange(true)
      header.props.onCheckedChange(false)
      const original =
        kind === "currency"
          ? { name: "Euro", code: "eur" }
          : { display_name: "Canada", iso_2: "ca" }
      const row = {
        original,
        getCanSelect: () => true,
        getIsSelected: () => false,
        toggleSelected: (value) => calls.push(["row", value]),
      }
      const cell = menuNodes(select.cell({ row }), "checkbox")[0]
      assert.equal(
        cell.props["aria-label"],
        kind === "currency" ? "Select Euro (EUR)" : "Select Canada (CA)"
      )
      assert.equal(cell.props.checked, false)
      assert.match(cell.props.className, /min-h-6 min-w-6/u)
      cell.props.onCheckedChange(true)
      cell.props.onClick({ stopPropagation: () => calls.push(["stop"]) })
      assert.deepEqual(calls, [
        ["page", true],
        ["page", false],
        ["row", true],
        ["stop"],
      ])
      if (preselected) {
        row.getCanSelect = () => false
        const existing = menuNodes(select.cell({ row }), "checkbox")[0]
        assert.equal(existing.props.checked, true)
        assert.equal(existing.props.disabled, true)
        assert.equal(existing.props["aria-label"], cell.props["aria-label"])
      }
    })
  }
}

for (const entry of ["chunk-QIJSUXW3.mjs", "app.js"]) {
  test(`${entry}: native Settings group keeps Radix disclosure identity`, () => {
    const expression = nativeArrow(entry, "CollapsibleGroup")
    const jsx = (type, props) => ({ type, props })
    const collapsible = { Root: "root", Trigger: "trigger", Content: "content" }
    const context = { jsx, jsxs: jsx }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^jsx\d*$/u.test(token) || /^jsxs\d*$/u.test(token))
        context[token] = jsx
      if (/^RadixCollapsible\d*$/u.test(token)) context[token] = collapsible
      if (/^IconButton\d*$/u.test(token)) context[token] = "icon-button"
      if (/^Text\d*$/u.test(token)) context[token] = "text"
      if (/^MinusMini\d*$/u.test(token)) context[token] = "minus"
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
      if (/^import_ui\d*$/u.test(token))
        context[token] = { IconButton: "icon-button", Text: "text" }
      if (/^import_radix_ui\d*$/u.test(token))
        context[token] = { Collapsible: collapsible }
      if (/^import_icons\d*$/u.test(token))
        context[token] = { MinusMini: "minus" }
    }
    const children = { type: "owned-link", props: {} }
    const tree = vm.runInNewContext(
      `(${expression})`,
      context
    )({ label: "Translated General", children })
    assert.equal(tree.props.defaultOpen, true)
    assert.equal(menuNodes(tree, "trigger")[0].props.asChild, true)
    assert.equal(
      menuNodes(tree, "icon-button")[0].props["aria-label"],
      "Translated General"
    )
    assert.equal(
      menuNodes(tree, "content")[0].props.children.props.children,
      children
    )
  })
}

for (const entry of ["chunk-ZUBJF5QL.mjs", "app.js"]) {
  test(`${entry}: native RouteDrawer Escape defers only to its expanded combobox`, () => {
    const expression = nativeArrow(entry, "Root")
    const jsx = (type, props) => ({ type, props })
    const drawer = Object.assign("drawer", { Content: "content" })
    const context = {
      jsx,
      jsxs: jsx,
      Drawer: drawer,
      clx: () => "native",
      useNavigate: () => () => {},
      useStateAwareTo: () => "..",
      useState: () => [true, () => {}],
      useEffect: () => {},
      useRef: () => ({ current: null }),
      RouteModalProvider: "route-provider",
      StackedModalProvider: "stacked-provider",
    }
    class NativeElement {
      constructor(expanded) {
        this.expanded = expanded
      }
      closest(selector) {
        assert.equal(selector, '[role="combobox"][aria-expanded="true"]')
        return this.expanded ? this : null
      }
    }
    context.Element = NativeElement
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
      if (/^import_ui\d*$/u.test(token))
        context[token] = { Drawer: drawer, clx: context.clx }
      if (/^import_react\d*$/u.test(token))
        context[token] = {
          useState: context.useState,
          useEffect: context.useEffect,
          useRef: context.useRef,
        }
      if (/^import_react_router_dom\d*$/u.test(token))
        context[token] = { useNavigate: context.useNavigate }
    }
    const tree = vm.runInNewContext(
      `(${expression})`,
      context
    )({ children: "native-form" })
    const content = menuNodes(tree, "content")[0]
    let prevented = 0
    for (const target of [new NativeElement(false), {}, null])
      content.props.onEscapeKeyDown({
        target,
        preventDefault: () => prevented++,
      })
    assert.equal(prevented, 0)
    content.props.onEscapeKeyDown({
      target: new NativeElement(true),
      preventDefault: () => prevented++,
    })
    assert.equal(prevented, 1)
    assert.equal(content.props.children, "native-form")
    assert.equal(tree.props.open, true)
  })
}

for (const distribution of ["esm", "cjs"]) {
  test(`${distribution}: native table preserves keyboard scrolling and sorting`, () => {
    const expression = nativeArrow(
      `${distribution}/blocks/data-table/components/data-table-table.js`,
      "DataTableTable",
      uiRoot
    )
    const createElement = (type, props, ...children) => ({
      type,
      props: { ...props, children: children.flat(Infinity) },
    })
    const react = {
      createElement,
      useRef: () => ({ current: null }),
      useState: () => [false, () => {}],
      useMemo: (factory) => factory(),
      useEffect: () => {},
    }
    const table = Object.assign("table", {
      Header: "header",
      Row: "row",
      Body: "body",
      HeaderCell: "header-cell",
    })
    const flexRender = (value, ctx) =>
      typeof value === "function" ? value(ctx) : value
    const sensorCalls = []
    const core = {
      DndContext: "drag",
      closestCenter: "center",
      KeyboardSensor: "keyboard",
      PointerSensor: "pointer",
      useSensor: (sensor, options) => {
        const captured = { sensor, options }
        sensorCalls.push(captured)
        return captured
      },
      useSensors: (...sensors) => sensors,
    }
    const sortable = {
      arrayMove: () => {},
      SortableContext: "sortable",
      sortableKeyboardCoordinates: "coords",
      horizontalListSortingStrategy: "strategy",
    }
    let sorted = 0
    const columns = [true, false].map((canSort, index) => ({
      id: `column-${index}`,
      columnDef: { header: index === 0 ? "SKU" : "Plain" },
      getCanSort: () => canSort,
      getIsSorted: () => false,
      getFirstSortDir: () => "asc",
      getToggleSortingHandler: () => () => sorted++,
    }))
    const headers = columns.map((column) => ({
      id: column.id,
      column,
      getContext: () => ({ column }),
    }))
    const instance = {
      pageIndex: 0,
      getAllColumns: () => columns,
      getHeaderGroups: () => [{ id: "group", headers }],
      getRowModel: () => ({ rows: [] }),
      emptyState: "populated",
    }
    const context = {
      React: react,
      Table: table,
      flexRender,
      ...core,
      ...sortable,
      useDataTableContext: () => ({ instance }),
      clx: (...args) => args.filter((arg) => typeof arg === "string").join(" "),
      DataTableEmptyState: { POPULATED: "populated" },
      DataTableEmptyStateDisplay: "empty-state",
      DataTableSortableHeaderCell: "sortable-cell",
      DataTableNonSortableHeaderCell: "non-sortable-cell",
      DataTableSortingIcon: "sort-icon",
    }
    Object.assign(context, {
      table_1: { Table: table },
      react_table_1: { flexRender },
      core_1: core,
      sortable_1: sortable,
      use_data_table_context_1: {
        useDataTableContext: context.useDataTableContext,
      },
      clx_1: { clx: context.clx },
      types_1: { DataTableEmptyState: context.DataTableEmptyState },
      data_table_sortable_header_cell_1: {
        DataTableSortableHeaderCell: "sortable-cell",
      },
      data_table_non_sortable_header_cell_1: {
        DataTableNonSortableHeaderCell: "non-sortable-cell",
      },
      data_table_sorting_icon_1: { DataTableSortingIcon: "sort-icon" },
    })
    const nativeTable = vm.runInNewContext(`(${expression})`, context)
    for (const enableColumnOrder of [false, true]) {
      instance.enableColumnOrder = enableColumnOrder
      sensorCalls.length = 0
      const rendered = nativeTable({})
      assert.equal(sensorCalls.length, 2)
      assert.equal(sensorCalls[0].sensor, "pointer")
      assert.equal(sensorCalls[0].options.activationConstraint.distance, 8)
      assert.equal(sensorCalls[1].sensor, "keyboard")
      assert.equal(sensorCalls[1].options.coordinateGetter, "coords")
      const scrollRegions = menuNodes(rendered, "div").filter((node) =>
        node.props.className?.includes("overflow-auto overscroll-auto")
      )
      assert.equal(scrollRegions.length, 1)
      assert.equal(scrollRegions[0].props.tabIndex, 0)
      assert.equal(typeof scrollRegions[0].props.onScroll, "function")
      assert.equal(typeof scrollRegions[0].props.ref, "object")
      const buttons = menuNodes(rendered, "button")
      assert.equal(buttons.length, 1)
      const button = buttons[0]
      assert.equal(button.props.style.minHeight, 24)
      assert.equal(button.props.style.minWidth, 24)
      assert.equal(button.props.type, "button")
      button.props.onClick()
      let stopped = false
      button.props.onMouseDown({
        stopPropagation: () => {
          stopped = true
        },
      })
      assert.equal(stopped, true)
      const plain = menuNodes(rendered, "div").find((node) =>
        node.props.children.includes("Plain")
      )
      assert.equal(plain.props.style, undefined)
      assert.equal(plain.props.onClick, undefined)
    }
    assert.equal(sorted, 2)
  })
}

for (const entry of ["region-list-476M4XVG.mjs", "app.js"]) {
  test(`${entry}: native Regions Actions header is translated and reactive`, () => {
    const expression = nativeArrow(
      entry,
      entry === "app.js" ? "useColumns31" : "useColumns"
    )
    const base = [{ id: "name" }]
    const columnHelper = { display: (props) => props }
    const jsx = (type, props) => ({ type, props })
    const t = (key) => {
      assert.equal(key, "fields.actions")
      return "Translated actions"
    }
    let dependencies
    const useMemo = (factory, deps) => {
      dependencies = deps
      return factory()
    }
    const useTranslation = () => ({ t })
    const context = {
      useMemo,
      useTranslation,
      useRegionTableColumns: () => base,
      columnHelper,
      jsx,
      RegionListTableActions: "region-actions",
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^columnHelper\d*$/u.test(token)) context[token] = columnHelper
      if (/^jsx\d*$/u.test(token)) context[token] = jsx
      if (/^useTranslation\d*$/u.test(token)) context[token] = useTranslation
      if (/^import_react\d*$/u.test(token)) context[token] = { useMemo }
      if (/^import_react_i18next\d*$/u.test(token))
        context[token] = { useTranslation }
      if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = { jsx }
    }
    const useColumns = vm.runInNewContext(`(${expression})`, context)
    const columns = useColumns()
    assert.equal(columns[0], base[0])
    const actions = columns.find((column) => column.id === "actions")
    assert.equal(actions.header, "Translated actions")
    assert.ok(dependencies.includes(base))
    assert.ok(dependencies.includes(t))
    const region = { id: "reg_owned_native_test" }
    const cell = actions.cell({ row: { original: region } })
    assert.equal(cell.type, "region-actions")
    assert.deepEqual(Object.keys(cell.props), ["region"])
    assert.equal(cell.props.region, region)
  })
}

for (const entry of ["chunk-YBQ5L5LG.mjs", "components.js", "app.js"]) {
  test(`${entry}: configurable native Actions header uses its translated name`, () => {
    const expression = nativeArrow(entry, "useConfigurableTableColumns")
    const jsx = (type, props) => ({ type, props })
    const columnHelper = { accessor: (_accessor, props) => props }
    const useMemo = (factory) => factory()
    const useTranslation = () => ({ t: (key) => key })
    const context = {
      jsx,
      jsxs: jsx,
      useMemo,
      useTranslation,
      createDataTableColumnHelper: () => columnHelper,
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^jsx\d*$/u.test(token)) context[token] = jsx
      if (/^useMemo\d*$/u.test(token)) context[token] = useMemo
      if (/^useTranslation\d*$/u.test(token)) context[token] = useTranslation
      if (/^createDataTableColumnHelper\d*$/u.test(token))
        context[token] = context.createDataTableColumnHelper
      if (/^import_jsx_runtime\d*$/u.test(token))
        context[token] = { jsx, jsxs: jsx }
      if (/^import_react\d*$/u.test(token)) context[token] = { useMemo }
      if (/^import_react_i18next\d*$/u.test(token))
        context[token] = { useTranslation }
      if (/^import_ui\d*$/u.test(token))
        context[token] = {
          createDataTableColumnHelper: context.createDataTableColumnHelper,
        }
    }
    const row = { id: "owned-row" }
    const content = { type: "owned-actions", props: {} }
    const native = vm.runInNewContext(`(${expression})`, context)
    const [column] = native(
      [
        {
          field: "actions",
          render_mode: "actions",
          name: "Translated Actions",
          hideable: true,
        },
      ],
      {
        renderRowActions: (value) => {
          assert.equal(value, row)
          return content
        },
      }
    )
    assert.equal(column.header().props.children, "Translated Actions")
    assert.equal(column.header().props.className, "sr-only")
    const cell = column.cell({ row: { original: row } })
    assert.equal(cell.props.children, content)
    let stopped = false
    cell.props.onClick({
      stopPropagation: () => {
        stopped = true
      },
    })
    assert.equal(stopped, true)
    assert.equal(column.enableSorting, false)
    assert.equal(column.enableHiding, true)
    assert.equal(native(undefined).length, 0)
  })
}

for (const distribution of ["esm", "cjs"]) {
  test(`${distribution}: native column drag handle owns activator semantics separately from header`, () => {
    const entry = `${distribution}/blocks/data-table/components/data-table-sortable-header-cell.js`
    const ts = backendRequire("typescript")
    const parsed = ts.createSourceFile(
      entry,
      readFileSync(join(uiRoot, "dist", entry), "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const matches = []
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(parsed).endsWith(".forwardRef") &&
        node.arguments[0] &&
        ts.isArrowFunction(node.arguments[0])
      )
        matches.push(node.arguments[0])
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    assert.equal(matches.length, 1)
    const expression = matches[0].getText(parsed)
    const createElement = (type, props, ...children) => ({
      type,
      props: { ...props, children: children.flat(Infinity) },
    })
    const refs = []
    const keyHandler = () => "native-key"
    const pointerHandler = () => "native-pointer"
    const useSortable = (input) => {
      assert.equal(input.id, "owned-column")
      return {
        attributes: {
          role: "button",
          tabIndex: 0,
          "aria-describedby": "native-dnd-instructions",
        },
        listeners: { onKeyDown: keyHandler, onPointerDown: pointerHandler },
        setNodeRef: (node) => refs.push(["cell", node]),
        setActivatorNodeRef: (node) => refs.push(["activator", node]),
        transform: { x: 10, y: 70, scaleX: 3, scaleY: 3 },
        transition: "native-transition",
        isDragging: false,
      }
    }
    const table = { HeaderCell: "header-cell" }
    const CSS = {
      Transform: {
        toString: (value) => {
          assert.equal(value.x, 10)
          assert.equal(value.y, 0)
          assert.equal(value.scaleX, 1)
          return "translateX(10px)"
        },
      },
    }
    const clx = (...values) =>
      values.filter((value) => typeof value === "string").join(" ")
    const context = {
      React: { createElement },
      useSortable,
      CSS,
      clx,
      Table: table,
      IconButton: "icon-button",
      DotsSix: "dots",
      sortable_1: { useSortable },
      utilities_1: { CSS },
      clx_1: { clx },
      table_1: { Table: table },
      icon_button_1: { IconButton: "icon-button" },
      icons_1: { DotsSix: "dots" },
    }
    const native = vm.runInNewContext(`(${expression})`, context)
    const sort = {
      type: "button",
      props: { children: "Translated Name", onClick: () => "sort" },
    }
    const forwarded = { current: null }
    const cell = native(
      {
        id: "owned-column",
        columnName: "Translated Name",
        children: sort,
        style: { width: 150 },
        "data-owned": "preserved",
      },
      forwarded
    )
    assert.equal(cell.type, "header-cell")
    assert.equal(cell.props.role, undefined)
    assert.equal(cell.props.tabIndex, undefined)
    assert.equal(cell.props.onKeyDown, undefined)
    assert.equal(cell.props.onPointerDown, undefined)
    assert.equal(cell.props.columnName, undefined)
    assert.equal(cell.props["data-owned"], "preserved")
    assert.equal(cell.props.style.width, 150)
    assert.equal(cell.props.style.transform, "translateX(10px)")
    const handle = menuNodes(cell, "icon-button")[0]
    assert.equal(handle.props["aria-label"], "Reorder Translated Name")
    assert.equal(handle.props.style.minHeight, 24)
    assert.equal(handle.props.style.minWidth, 24)
    assert.equal(handle.props.role, "button")
    assert.equal(handle.props.tabIndex, 0)
    assert.equal(handle.props["aria-describedby"], "native-dnd-instructions")
    assert.equal(handle.props.onKeyDown, keyHandler)
    assert.equal(handle.props.onPointerDown, pointerHandler)
    assert.equal(menuNodes(cell, "button")[0], sort)
    const node = { id: "actual-cell" }
    cell.props.ref(node)
    handle.props.ref({ id: "actual-handle" })
    assert.equal(forwarded.current, node)
    assert.deepEqual(
      refs.map(([kind]) => kind),
      ["cell", "activator"]
    )
  })
}

for (const entry of ["role-detail-EQA63OFK.mjs", "app.js"]) {
  test(`${entry}: bounded native role summaries retain permission mounting and labels`, () => {
    const jsx = (type, props) => ({ type, props })
    const useMemo = (callback) => callback()
    const useTranslation = () => ({ t: (key) => key })
    const usePrompt = () => () => false
    const useNavigate = () => () => {}
    let permissions = new Set(["user:read", "rbac_policy:read"])
    const render = vm.runInNewContext(
      `(${nativeArrow(entry, "RoleGeneralSection")})`,
      {
        jsx2: jsx,
        jsxs: jsx,
        import_jsx_runtime629: { jsx, jsxs: jsx },
        Container: "container",
        Heading: "heading",
        usePrompt,
        import_ui397: { Container: "container", Heading: "heading", usePrompt },
        useTranslation,
        import_react_i18next450: { useTranslation },
        useMemo,
        import_react334: { useMemo },
        useNavigate,
        import_react_router_dom204: { useNavigate },
        usePermissions: () => ({
          hasPermission: (key) => permissions.has(key),
        }),
        useDeleteRbacRole: () => ({ mutateAsync: () => {}, isPending: false }),
        SectionRow: "section-row",
        ListSummary: "list-summary",
      }
    )
    const role = {
      id: "role_owned",
      name: "Owned role",
      users_link: [
        { user: { first_name: "Fixture", last_name: "Operator" } },
        { user: { email: "fixture@example.invalid" } },
        { user: { id: "user_fixture" } },
        { user: null },
      ],
      policies: [
        { id: "policy_1", key: "product:read" },
        { id: "policy_2", resource: "order", operation: "read" },
        { id: "policy_3" },
      ],
    }
    const rows = menuNodes(render({ role }), "section-row")
    const summaries = rows.filter((row) => row.props.value?.type === "div")
    assert.equal(summaries.length, 2)
    for (const summary of summaries)
      assert.equal(
        summary.props.value.props.className,
        "inline-flex min-w-0 max-w-full"
      )
    assert.deepEqual(
      Array.from(summaries[0].props.value.props.children.props.list),
      ["Fixture Operator", "fixture@example.invalid", "user_fixture"]
    )
    assert.deepEqual(
      Array.from(summaries[1].props.value.props.children.props.list),
      ["product:read", "order:read", "policy_3"]
    )
    permissions = new Set()
    const denied = render({ role })
    assert.equal(menuNodes(denied, "div")[0].props.children[1], false)
    assert.equal(menuNodes(render({ role }), "section-row").length, 1)
    permissions = new Set(["user:read"])
    assert.equal(
      menuNodes(render({ role: { ...role, users_link: [] } }), "section-row")[1]
        .props.value,
      "-"
    )
  })
}

for (const [entry, component] of [
  ["role-detail-EQA63OFK.mjs", "useColumns"],
  ["app.js", "useColumns42"],
]) {
  test(`${entry}: native role user selection keeps denied assignment disabled`, () => {
    const jsx = (type, props) => ({ type, props })
    const helper = {
      display: (value) => value,
      accessor: (field, value) => ({ field, ...value }),
    }
    const useMemo = (callback) => callback()
    const useTranslation = () => ({ t: (key) => key })
    const columns = vm.runInNewContext(`(${nativeArrow(entry, component)})`, {
      jsx3: jsx,
      import_jsx_runtime630: { jsx },
      Checkbox: "checkbox",
      import_ui398: { Checkbox: "checkbox" },
      useTranslation2: useTranslation,
      import_react_i18next451: { useTranslation },
      useMemo2: useMemo,
      import_react335: { useMemo },
      useDate: () => ({ getFullDate: () => "fixture date" }),
      columnHelper: helper,
      columnHelper79: helper,
    })
    let pageValue,
      rowValue,
      stopped = false
    const table = {
      getIsSomePageRowsSelected: () => true,
      getIsAllPageRowsSelected: () => false,
      toggleAllPageRowsSelected: (value) => {
        pageValue = value
      },
    }
    const row = {
      original: {
        id: "user_owned",
        first_name: "Fixture",
        last_name: "Operator",
      },
      getIsSelected: () => false,
      getCanSelect: () => false,
      toggleSelected: (value) => {
        rowValue = value
      },
    }
    const selection = columns(false).find((column) => column.id === "select")
    const header = selection.header({ table }).props
    const cell = selection.cell({ row }).props
    assert.equal(header["aria-label"], "general.selectAll")
    assert.equal(cell["aria-label"], "actions.select Fixture Operator")
    assert.equal(header.disabled, true)
    assert.equal(cell.disabled, true)
    assert.equal(header.checked, "indeterminate")
    assert.equal(cell.checked, false)
    for (const props of [header, cell]) {
      assert.equal(props.style.minWidth, 24)
      assert.equal(props.style.minHeight, 24)
      assert.equal(props.style.flexShrink, 0)
    }
    // Native handlers remain exact for callers already permitted to select.
    const allowed = columns(true).find((column) => column.id === "select")
    assert.equal(allowed.header({ table }).props.disabled, false)
    header.onCheckedChange(true)
    cell.onCheckedChange(0)
    cell.onClick({
      stopPropagation: () => {
        stopped = true
      },
    })
    assert.equal(pageValue, true)
    assert.equal(rowValue, false)
    assert.equal(stopped, true)
    const actions = columns(false)
      .find((column) => column.id === "actions")
      .header()
    assert.equal(actions.props.className, "sr-only")
    assert.equal(actions.props.children, "fields.actions")
  })
}

const assertNativeRouteInvokerFallback = (entry, kind) => {
  const expression = nativeArrow(
    entry,
    kind === "drawer" ? "Root" : entry === "app.js" ? "Root2" : "Root"
  )
  class NativeHTMLElement {
    isConnected = true
    disabled = false
    ariaDisabled = false
    hidden = false
    rects = [{}]
    style = { visibility: "visible", display: "block" }
    focused = 0
    getClientRects() {
      return this.rects
    }
    matches(selector) {
      assert.equal(
        selector,
        kind === "drawer" ? ":disabled, [aria-disabled=\'true\']" : ":disabled"
      )
      return this.disabled || (kind === "drawer" && this.ariaDisabled)
    }
    closest(selector) {
      assert.equal(selector, '[aria-hidden="true"], [inert]')
      return this.hidden ? this : null
    }
    focus(options) {
      assert.equal(options.preventScroll, true)
      this.focused++
    }
  }
  const jsx = (type, props) => ({ type, props })
  const render = (captured = new NativeHTMLElement()) => {
    const queued = []
    const body = new NativeHTMLElement()
    body.style.pointerEvents = "none"
    const document = { body, activeElement: captured }
    const navigation = []
    const context = {
      jsx4: jsx,
      jsx,
      Drawer: Object.assign("drawer", { Content: "content" }),
      clx: () => "native",
      FocusModal: "focus-modal",
      Content: "content",
      RouteModalProvider: "route-provider",
      StackedModalProvider: "stacked-provider",
      useNavigate2:
        () =>
        (...args) =>
          navigation.push(args),
      useNavigate:
        () =>
        (...args) =>
          navigation.push(args),
      useState: (value) => [value, () => {}],
      useStateAwareTo: () => "..",
      useState3: (value) => [value, () => {}],
      useRef: () => ({ current: null }),
      useEffect: (effect) => effect(),
      queueMicrotask: (callback) => queued.push(callback),
      getComputedStyle: (target) => target.style,
      HTMLElement: NativeHTMLElement,
      document,
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = { jsx }
      if (/^import_ui\d*$/u.test(token))
        context[token] = {
          FocusModal: "focus-modal",
          Drawer: context.Drawer,
          clx: context.clx,
        }
      if (/^import_react\d*$/u.test(token))
        context[token] = {
          useState: context.useState3,
          useRef: context.useRef,
          useEffect: context.useEffect,
        }
      if (/^import_react_router_dom\d*$/u.test(token))
        context[token] = { useNavigate: context.useNavigate2 }
    }
    const tree = vm.runInNewContext(
      `(${expression})`,
      context
    )({ children: "native-form" })
    return {
      target: captured,
      body,
      document,
      queued,
      tree,
      navigation,
      callback: menuNodes(tree, "content")[0].props.onCloseAutoFocus,
    }
  }
  const fallback = render()
  fallback.document.activeElement = fallback.body
  const event = { defaultPrevented: false }
  fallback.callback(event)
  assert.equal(fallback.target.focused, 0)
  // Installed Radix prevents its close event after the supplied callback.
  // That native default must not disable the already scheduled fallback.
  event.defaultPrevented = true
  fallback.queued.shift()()
  assert.equal(fallback.target.focused, 1)
  fallback.tree.props.onOpenChange(false)
  assert.deepEqual(JSON.parse(JSON.stringify(fallback.navigation)), [
    ["..", { replace: true }],
  ])
  assert.equal(fallback.body.style.pointerEvents, "auto")
  const nativeTrigger = render()
  nativeTrigger.document.activeElement = nativeTrigger.body
  nativeTrigger.callback({ defaultPrevented: false })
  nativeTrigger.document.activeElement = new NativeHTMLElement()
  nativeTrigger.queued.shift()()
  assert.equal(nativeTrigger.target.focused, 0)
  const prevented = render()
  prevented.callback({ defaultPrevented: true })
  assert.equal(prevented.queued.length, 0)
  for (const alter of [
    (target) => {
      target.isConnected = false
    },
    (target) => {
      target.rects = []
    },
    (target) => {
      target.disabled = true
    },
    (target) => {
      target.hidden = true
    },
    (target) => {
      target.style.visibility = "hidden"
    },
    (target) => {
      target.style.display = "none"
    },
  ]) {
    const invalid = render()
    invalid.document.activeElement = invalid.body
    invalid.callback({ defaultPrevented: false })
    alter(invalid.target)
    invalid.queued.shift()()
    assert.equal(invalid.target.focused, 0)
  }
  if (kind === "drawer") {
    const invalid = render()
    invalid.document.activeElement = invalid.body
    invalid.callback({ defaultPrevented: false })
    invalid.target.ariaDisabled = true
    invalid.queued.shift()()
    assert.equal(invalid.target.focused, 0)
  }
  const unfocused = render({})
  unfocused.document.activeElement = unfocused.body
  unfocused.callback({ defaultPrevented: false })
  unfocused.queued.shift()()
}

for (const entry of ["chunk-H7AAHR2V.mjs", "app.js"]) {
  test(`${entry}: routed modal fallback waits for native focus and rejects stale invokers`, () => {
    assertNativeRouteInvokerFallback(entry, "focus")
  })

  test(`${entry}: routed modal retains dirty-form Escape and supplied close callback`, () => {
    const expression = nativeArrow(entry, "Content")
    let closeOnEscape = false
    class NativeElement {
      constructor(expanded) {
        this.expanded = expanded
      }
      closest(selector) {
        assert.equal(selector, '[role="combobox"][aria-expanded="true"]')
        return this.expanded ? this : null
      }
    }
    const jsx = (type, props) => ({ type, props })
    const context = {
      jsx4: jsx,
      FocusModal: { Content: "focus-content" },
      clx: () => "native",
      useRouteModal: () => ({ __internal: { closeOnEscape } }),
      Element: NativeElement,
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = { jsx }
      if (/^import_ui\d*$/u.test(token))
        context[token] = { FocusModal: context.FocusModal, clx: context.clx }
    }
    const content = vm.runInNewContext(`(${expression})`, context)
    const callback = () => {}
    const blocked = content({
      onCloseAutoFocus: callback,
      children: "native-form",
    })
    assert.equal(blocked.props.onCloseAutoFocus, callback)
    let prevented = 0
    blocked.props.onEscapeKeyDown({
      target: null,
      preventDefault: () => prevented++,
    })
    assert.equal(prevented, 1)
    closeOnEscape = true
    const allowed = content({
      onCloseAutoFocus: callback,
      children: "native-form",
    })
    allowed.props.onEscapeKeyDown({
      target: new NativeElement(false),
      preventDefault: () => prevented++,
    })
    assert.equal(prevented, 1)
    allowed.props.onEscapeKeyDown({
      target: new NativeElement(true),
      preventDefault: () => prevented++,
    })
    assert.equal(prevented, 2)
  })
}

for (const entry of ["chunk-6HTZNHPT.mjs", "app.js"]) {
  const renderNativeKeyboundForm = (props = {}) => {
    const ts = backendRequire("typescript")
    const parsed = ts.createSourceFile(
      entry,
      readFileSync(join(dashboardRoot, "dist", entry), "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const matches = []
    const visit = (node) => {
      const assigned =
        ts.isVariableDeclaration(node) &&
        node.name.getText(parsed) === "KeyboundForm"
          ? node.initializer
          : ts.isBinaryExpression(node) &&
              node.left.getText(parsed) === "KeyboundForm"
            ? node.right
            : null
      if (
        assigned &&
        ts.isCallExpression(assigned) &&
        assigned.expression.getText(parsed).endsWith(".forwardRef") &&
        ts.isArrowFunction(assigned.arguments[0])
      )
        matches.push(assigned.arguments[0])
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    assert.equal(matches.length, 1)
    const expression = matches[0].getText(parsed)
    class NativeButton {
      constructor(type = "button", disabled = false) {
        this.type = type
        this.disabled = disabled
      }
    }
    class NativeAnchor {
      constructor(href = true) {
        this.href = href
      }
      hasAttribute(name) {
        assert.equal(name, "href")
        return this.href
      }
    }
    class NativeTextArea {}
    const jsx = (type, attributes) => ({ type, props: attributes })
    const context = {
      jsx,
      HTMLButtonElement: NativeButton,
      HTMLAnchorElement: NativeAnchor,
      HTMLTextAreaElement: NativeTextArea,
    }
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = { jsx }
    }
    const forwarded = { current: null }
    const native = vm.runInNewContext(`(${expression})`, context)
    return {
      form: native(props, forwarded),
      forwarded,
      NativeButton,
      NativeAnchor,
      NativeTextArea,
    }
  }
  const keyboardEvent = (target, changes = {}) => ({
    key: "Enter",
    target,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    prevented: 0,
    preventDefault() {
      this.defaultPrevented = true
      this.prevented++
    },
    ...changes,
  })

  test(`${entry}: KeyboundForm retains native button and link Enter activation`, () => {
    const submissions = []
    const { form, NativeButton, NativeAnchor } = renderNativeKeyboundForm({
      onSubmit: (event) => submissions.push(event),
      "data-owned": "preserved",
    })
    assert.equal(form.type, "form")
    assert.equal(form.props["data-owned"], "preserved")
    for (const target of [
      new NativeButton("button"),
      new NativeButton("submit"),
      new NativeButton("reset"),
      new NativeButton("submit", true),
      new NativeAnchor(),
    ]) {
      const event = keyboardEvent(target)
      form.props.onKeyDown(event)
      assert.equal(event.prevented, 0)
      assert.equal(submissions.length, 0)
    }
    // A real native submit event still reaches validation exactly once.
    const nativeSubmit = keyboardEvent(new NativeButton("submit"))
    form.props.onSubmit(nativeSubmit)
    assert.equal(nativeSubmit.prevented, 1)
    assert.equal(submissions.length, 1)
    assert.equal(submissions[0], nativeSubmit)
    const preventedChild = keyboardEvent(
      {},
      { defaultPrevented: true, ctrlKey: true }
    )
    form.props.onKeyDown(preventedChild)
    assert.equal(preventedChild.prevented, 0)
    assert.equal(submissions.length, 1)
    const suppliedHandler = () => "caller-handler"
    const supplied = renderNativeKeyboundForm({ onKeyDown: suppliedHandler })
    assert.equal(supplied.form.props.onKeyDown, suppliedHandler)
    assert.equal(supplied.form.props.ref, supplied.forwarded)
  })

  test(`${entry}: KeyboundForm blocks field Enter and preserves textarea and shortcuts`, () => {
    const submissions = []
    const { form, NativeButton, NativeAnchor, NativeTextArea } =
      renderNativeKeyboundForm({
        onSubmit: (event) => submissions.push(event),
      })
    for (const target of [{}, new NativeAnchor(false)]) {
      const event = keyboardEvent(target)
      form.props.onKeyDown(event)
      assert.equal(event.prevented, 1)
      assert.equal(submissions.length, 0)
    }
    const newline = keyboardEvent(new NativeTextArea())
    form.props.onKeyDown(newline)
    assert.equal(newline.prevented, 0)
    const ordinaryKey = keyboardEvent({}, { key: "Escape" })
    form.props.onKeyDown(ordinaryKey)
    assert.equal(ordinaryKey.prevented, 0)
    for (const shortcut of [{ ctrlKey: true }, { metaKey: true }]) {
      for (const target of [
        {},
        new NativeTextArea(),
        new NativeButton("submit"),
      ]) {
        const event = keyboardEvent(target, shortcut)
        form.props.onKeyDown(event)
        assert.equal(event.defaultPrevented, true)
        assert.equal(submissions.at(-1), event)
      }
    }
    assert.equal(submissions.length, 6)
    for (const modifier of [{ altKey: true }, { shiftKey: true }]) {
      const event = keyboardEvent(new NativeButton(), modifier)
      form.props.onKeyDown(event)
      assert.equal(event.prevented, 1)
    }
    assert.equal(submissions.length, 6)
  })
}

const nativeSettingsContext = (expression, extra = {}) => {
  const jsx = (type, props) => ({ type, props })
  const translation = () => ({ t: (key) => key })
  const memo = (factory) => factory()
  const context = { jsx, jsxs: jsx, useMemo: memo, ...extra }
  for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
    if (/^jsx\d*$|^jsxs\d*$/u.test(token)) context[token] = jsx
    if (/^useTranslation\d*$/u.test(token)) context[token] = translation
    if (/^import_jsx_runtime\d*$/u.test(token))
      context[token] = { jsx, jsxs: jsx }
    if (/^import_react_i18next(?:\d*|_tax_table)$/u.test(token))
      context[token] = { useTranslation: translation }
    if (/^import_react\d*$/u.test(token)) context[token] = { useMemo: memo }
    if (/^(?:Container|Heading|Text|Button)\d*$/u.test(token))
      context[token] = token.replace(/\d+$/u, "").toLowerCase()
    if (/^import_ui\d*$/u.test(token))
      context[token] = {
        Container: "container",
        Heading: "heading",
        Text: "text",
        Button: "button",
      }
    if (/^import_react_query\d*$/u.test(token))
      context[token] = { keepPreviousData: "keep-previous" }
  }
  return context
}

for (const entry of ["chunk-QIJSUXW3.mjs", "app.js"]) {
  test(`${entry}: native global search requires open and current nonempty text`, () => {
    const expression = nativeArrow(entry, "useDynamicSearchResults")
    const hooks = [
      ...new Set(
        expression.match(
          /\buse(?:Orders|Products|Variants|ProductCategories|Collections|Customers|CustomerGroups|InventoryItems|Promotions|Campaigns|PriceLists|Users|Regions|TaxRegions|ReturnReasons|SalesChannels|ProductTypes|ProductTags|StockLocations|ShippingProfiles|ApiKeys)\b/gu
        )
      ),
    ]
    assert.equal(hooks.length, 21)
    for (const [open, q, debounced, area, enabled] of [
      [false, "record", "record", "all", 0],
      [true, undefined, "record", "all", 0],
      [true, "", "record", "all", 0],
      [true, "  ", "record", "all", 0],
      [true, "record", "  ", "all", 0],
      [true, "record", "record", "navigation", 0],
      [true, " record ", " record ", "all", 22],
      [true, "#12", "#12", "order", 1],
    ]) {
      const calls = []
      const context = nativeSettingsContext(expression, {
        useDebouncedSearch: () => debounced,
        useCallback2: (fn) => fn,
        isAreaEnabled: (current, target) =>
          current === "all" || current === target,
        transformDynamicSearchResults: () => ({ items: [] }),
        keepPreviousData: "keep-previous",
      })
      for (const token of new Set(expression.match(/\bimport_react\d*\b/gu)))
        context[token] = { useMemo: (fn) => fn(), useCallback: (fn) => fn }
      for (const hook of hooks)
        context[hook] = (query, options) => {
          calls.push({ hook, query, options })
          return { count: 0, isFetching: false }
        }
      vm.runInNewContext(`(${expression})`, context)(area, 3, q, open)
      assert.equal(calls.length, 22, "Hooks stay mounted in the same order")
      assert.equal(calls.filter((call) => call.options.enabled).length, enabled)
      assert.ok(calls.every((call) => call.query.limit === 3))
      const order = calls.find((call) => call.hook === "useOrders")
      assert.equal(order.query.q, debounced?.replace(/^#/, ""))
      const product = calls.find((call) => call.hook === "useProducts")
      assert.equal(product.query.q, debounced, "Wire query text is preserved")
    }
    const outer = nativeArrow(entry, "useSearchResults")
    let forwarded
    vm.runInNewContext(`(${outer})`, {
      useStaticSearchResults: () => [],
      useDynamicSearchResults: (...args) => {
        forwarded = args
        return {}
      },
    })({ q: "record", limit: 7, area: "product", isOpen: false })
    assert.deepEqual(JSON.parse(JSON.stringify(forwarded)), [
      "product",
      7,
      "record",
      false,
    ])
  })
}

for (const entry of ["user-list-NEIF3D5L.mjs", "app.js"]) {
  test(`${entry}: native Users preserves date queries and recovers malformed JSON`, () => {
    const expression = nativeArrow(entry, "UserListTable")
    const gte = { $gte: "2026-10-01T00:00:00.000Z" }
    const lt = { $lt: "2026-10-09T00:00:00.000Z" }
    const eq = { $eq: "2026-10-01T00:00:00.000Z" }
    const range = { ...gte, ...lt }
    const cases = [
      [undefined, undefined, undefined, undefined],
      ["", "", undefined, undefined],
      [JSON.stringify(gte), JSON.stringify(lt), gte, lt],
      [JSON.stringify(range), JSON.stringify(range), range, range],
      [JSON.stringify(eq), JSON.stringify(eq), eq, eq],
      ["not-json", JSON.stringify(lt), undefined, lt],
      [JSON.stringify(gte), "{", gte, undefined],
      ["not-json", "[", undefined, undefined],
      // Valid JSON still reaches native validation with its original shape.
      ["false", "[1]", false, [1]],
      ["null", "null", null, null],
    ]
    for (const [created, updated, expectedCreated, expectedUpdated] of cases) {
      let requested, params, placeholder
      let reads = 0
      const context = nativeSettingsContext(expression, {
        useQueryParams: (keys) => {
          requested = keys
          return {
            q: "owned",
            order: "-email",
            offset: "20",
            created_at: created,
            updated_at: updated,
          }
        },
        useUsers: (query, options) => {
          reads++
          params = query
          placeholder = options.placeholderData
          return { users: [], count: 21 }
        },
        useColumns: () => [],
        useColumns39: () => [],
        useFilters: () => [],
        useFilters3: () => [],
        PAGE_SIZE: 20,
        PAGE_SIZE52: 20,
        DataTable: "table",
        Container: "container",
        keepPreviousData: "keep-previous",
      })
      vm.runInNewContext(`(${expression})`, context)()
      assert.equal(reads, 1)
      assert.ok(
        requested.includes("created_at") && requested.includes("updated_at")
      )
      assert.equal(params.q, "owned")
      assert.equal(params.order, "-email")
      assert.equal(params.offset, 20)
      assert.equal(params.limit, 20)
      assert.equal(placeholder, "keep-previous")
      assert.equal(
        JSON.stringify(params.created_at),
        JSON.stringify(expectedCreated)
      )
      assert.equal(
        JSON.stringify(params.updated_at),
        JSON.stringify(expectedUpdated)
      )
    }
  })
}

for (const distribution of ["esm", "cjs"]) {
  test(`${distribution}: native Users date chips remain removable for malformed URL text`, () => {
    const datePredicate = nativeArrow(
      `${distribution}/blocks/data-table/utils/is-date-comparison-operator.js`,
      "isDateComparisonOperator",
      uiRoot
    )
    assert.match(
      datePredicate,
      /^(?:export )?function isDateComparisonOperator\(value\) \{/u
    )
    const isDateComparisonOperator = vm.runInNewContext(
      `(${datePredicate.startsWith("export ") ? datePredicate.slice(7) : datePredicate})`
    )
    const isDateFilterProps = vm.runInNewContext(
      `(${nativeArrow(
        `${distribution}/blocks/data-table/components/data-table-filter.js`,
        "isDateFilterProps",
        uiRoot
      )})`
    )
    const removed = []
    const formatted = []
    const gte = { $gte: "2026-10-01T00:00:00.000Z" }
    const meta = {
      type: "date",
      label: "Created at",
      options: [{ value: gte, label: "Owned preset" }],
      rangeOptionStartLabel: "Starting",
      rangeOptionEndLabel: "Ending",
      formatDateValue: (date) => {
        assert.ok(Number.isFinite(date.getTime()))
        formatted.push(date.toISOString())
        return date.toISOString().slice(0, 10)
      },
    }
    const filter = nativeMenuHarness(
      distribution,
      "filter",
      {
        getFilterMeta: () => meta,
        removeFilter: (id) => removed.push(id),
      },
      {
        isDateComparisonOperator,
        is_date_comparison_operator_1: { isDateComparisonOperator },
        isDateFilterProps,
        DataTableFilterDateContent: "date-content",
      }
    )
    for (const raw of ["not-json", "{", "["]) {
      const tree = filter({ id: "created_at", filter: raw })
      const remove = menuNodes(tree, "button").find(
        (node) => node.props["aria-label"] === "Remove: Created at"
      )
      assert.ok(remove)
      assert.equal(remove.props.type, "button")
      assert.equal(menuNodes(tree, "date-content").length, 1)
      // An unsupported raw URL value is not presented as a valid date range.
      assert.deepEqual(menuNodes(tree, "button")[0].props.children, ["\u00a0"])
      assert.equal(formatted.length, 0)
      remove.props.onClick()
      assert.equal(removed.at(-1), "created_at")
      let prevented = false
      menuNodes(tree, "popover-content")[0].props.onCloseAutoFocus({
        preventDefault: () => {
          prevented = true
        },
      })
      assert.equal(prevented, false)
    }
    assert.deepEqual(removed, ["created_at", "created_at", "created_at"])
    const preset = filter({ id: "created_at", filter: gte })
    assert.deepEqual(menuNodes(preset, "button")[0].props.children, [
      "Owned preset",
    ])
    const range = filter({
      id: "created_at",
      filter: { ...gte, $lte: "2026-10-09T00:00:00.000Z" },
    })
    assert.deepEqual(menuNodes(range, "button")[0].props.children, [
      "2026-10-01 - 2026-10-09",
    ])
    assert.deepEqual(formatted, [
      "2026-10-01T00:00:00.000Z",
      "2026-10-09T00:00:00.000Z",
    ])
  })
}

for (const entry of ["tax-region-list-A4DKSYFI.mjs", "app.js"]) {
  test(`${entry}: native Tax regions honors selected order and country default`, () => {
    const expression = nativeArrow(entry, "TaxRegionListView")
    for (const order of [undefined, "created_at", "-updated_at"]) {
      let params
      const context = nativeSettingsContext(expression, {
        useTaxRegionTableQuery: () => ({
          searchParams: { order, offset: 20, limit: 20 },
          raw: {},
        }),
        useTaxRegions: (query) => {
          params = query
          return { tax_regions: [], count: 21 }
        },
        useTaxRegionTable: () => ({ table: {} }),
        TaxRegionTable: "tax-table",
        Container: "container",
        Heading: "heading",
        Text: "text",
        PAGE_SIZE: 20,
        PAGE_SIZE78: 20,
        keepPreviousData: "keep-previous",
      })
      // The emitted CJS page-size symbol is scoped by its compiled function.
      for (const token of expression.match(/\bPAGE_SIZE\d*\b/gu) || [])
        context[token] = 20
      vm.runInNewContext(`(${expression})`, context)()
      assert.equal(params.order, order ?? "country_code")
      assert.equal(params.parent_id, "null")
      assert.equal(params.offset, 20)
      assert.equal(params.limit, 20)
    }
  })
}

for (const entry of ["chunk-Q6FVJ7BC.mjs", "app.js"]) {
  test(`${entry}: native Tax sort has translated typed choices in both loading states`, () => {
    const expression = nativeArrow(entry, "TaxRegionTable")
    const table = {
      getState: () => ({ pagination: { pageIndex: 0, pageSize: 20 } }),
      getRowModel: () => ({ rows: [] }),
      getCanNextPage: () => true,
      getCanPreviousPage: () => false,
      nextPage: () => {},
      previousPage: () => {},
      getPageCount: () => 2,
    }
    const context = nativeSettingsContext(expression, {
      DataTableOrderBy: "sort",
      LocalizedTablePagination: "pagination",
      Link: "link",
      NoRecords: "empty",
      NoResults: "no-results",
      TaxRegionCard: "card",
      TableFooterSkeleton: "skeleton",
      Button: "button",
    })
    for (const token of expression.match(/\bimport_react_router_dom\d*\b/gu) ||
      [])
      context[token] = { Link: "link" }
    const render = vm.runInNewContext(`(${expression})`, context)
    const pending = render({
      isPending: true,
      table,
      action: {},
      queryObject: {},
    })
    assert.equal(menuNodes(pending, "sort").length, 0)
    const tree = render({
      isPending: false,
      count: 21,
      prefix: "p",
      table,
      action: { label: "Create", to: "create" },
      queryObject: { order: "-updated_at" },
    })
    const sort = menuNodes(tree, "sort")[0]
    assert.equal(sort.props.prefix, "p")
    assert.deepEqual(JSON.parse(JSON.stringify(sort.props.keys)), [
      { key: "updated_at", label: "fields.updatedAt" },
      { key: "created_at", label: "fields.createdAt" },
    ])
    assert.equal(menuNodes(tree, "pagination")[0].props.prefix, "p")
  })
}

for (const entry of ["tax-region-detail-3IQOYPXE.mjs", "app.js"]) {
  test(`${entry}: native Tax province controls and reads share the p query namespace`, () => {
    const expression = nativeArrow(entry, "TaxRegionProvinceSection")
    const queryPrefixes = [],
      tablePrefixes = []
    const context = nativeSettingsContext(expression, {
      useTaxRegionTableQuery: (options) => {
        queryPrefixes.push(options.prefix)
        return { searchParams: {}, raw: {} }
      },
      useTaxRegions: () => ({ tax_regions: [], count: 21 }),
      useTaxRegionTable: (options) => {
        tablePrefixes.push(options.prefix)
        return { table: {} }
      },
      getCountryProvinceObjectByIso2: () => ({ type: "province" }),
      TaxRegionTable: "tax-table",
      Container: "container",
      Heading: "heading",
      keepPreviousData: "keep-previous",
    })
    for (const token of expression.match(/\bPREFIX\d*\b/gu) || [])
      context[token] = "p"
    for (const token of expression.match(/\bPAGE_SIZE\d*\b/gu) || [])
      context[token] = 10
    const tree = vm.runInNewContext(
      `(${expression})`,
      context
    )({
      taxRegion: { id: "txreg_owned", country_code: "us", children: [] },
      showSublevelRegions: true,
    })
    assert.deepEqual(queryPrefixes, ["p"])
    assert.deepEqual(tablePrefixes, ["p"])
    assert.equal(menuNodes(tree, "tax-table")[0].props.prefix, "p")
  })
}

// Render the shipped field callbacks with the real React 18, native Form/Slot
// and Medusa Select. These are label/control regressions, not browser or native
// mutation acceptance substitutes.
const nativeSelectField = (entry, component, fieldName) => {
  const ts = backendRequire("typescript")
  const expression = nativeArrow(entry, component)
  const parsed = ts.createSourceFile(
    entry,
    expression,
    ts.ScriptTarget.Latest,
    true
  )
  const matches = []
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const property = (name) =>
        node.properties.find(
          (candidate) =>
            ts.isPropertyAssignment(candidate) &&
            candidate.name.getText(parsed) === name
        )
      const name = property("name")?.initializer
      const render = property("render")?.initializer
      if (
        name &&
        ts.isStringLiteral(name) &&
        name.text === fieldName &&
        render &&
        ts.isArrowFunction(render)
      )
        matches.push(render.getText(parsed))
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(matches.length, 1)
  return matches[0]
}

const nativeSelectRenderContext = (expression, extra = {}) => {
  const react = dashboardRequire("react")
  const hookForm = dashboardRequire("react-hook-form")
  const ui = dashboardRequire("@medusajs/ui")
  const jsxRuntime = dashboardRequire("react/jsx-runtime")
  const source = readFileSync(
    join(dashboardRoot, "dist/chunk-OBQI23QM.mjs"),
    "utf8"
  )
  const start = source.indexOf("var Provider = ")
  const formStart = source.indexOf("Form = Object.assign(Provider", start)
  const end = source.indexOf("\n});", formStart) + 4
  assert.ok(start >= 0 && formStart > start && end > formStart)
  const translation = () => ({
    t: (key) =>
      ({
        "store.defaultCurrency": "Default currency",
        "fields.currency": "Currency",
        "fields.province": "Province",
      })[key] ?? key,
  })
  const { Form, FormFieldContext, FormItemContext } = vm.runInNewContext(
    `${source.slice(start, end)}; ({ Form, FormFieldContext, FormItemContext });`,
    {
      ...react,
      ...hookForm,
      ...ui,
      ...jsxRuntime,
      LabelComponent: ui.Label,
      HintComponent: ui.Hint,
      Slot: dashboardRequire("radix-ui").Slot,
      useTranslation: translation,
    }
  )
  const context = {
    ...react,
    ...ui,
    ...jsxRuntime,
    Form,
    direction: "ltr",
    t: translation().t,
    t5: translation().t,
    useTranslation: translation,
    ...extra,
  }
  for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
    if (/^jsx\d*$/u.test(token)) context[token] = jsxRuntime.jsx
    if (/^jsxs\d*$/u.test(token)) context[token] = jsxRuntime.jsxs
    if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = jsxRuntime
    if (/^import_ui\d*$/u.test(token)) context[token] = ui
    if (/^import_react\d*$/u.test(token)) context[token] = react
    if (/^import_react_i18next\d*$/u.test(token))
      context[token] = { useTranslation: translation }
  }
  const render = vm.runInNewContext(`(${expression})`, context)
  const markup = (fieldName, content) => {
    const Host = () => {
      const form = hookForm.useForm({ defaultValues: { [fieldName]: "" } })
      assert.equal(content.type, Form.Item)
      // Supply the post-mount native Form.Item context explicitly for static
      // rendering; no fake control, DOM assignment or browser acceptance.
      const itemContext = {
        id: "native_owned_field",
        hasLabel: true,
        hasHint: false,
        hasMessage: false,
      }
      return react.createElement(
        Form,
        { ...form },
        react.createElement(
          FormFieldContext.Provider,
          { value: { name: fieldName } },
          react.createElement(
            FormItemContext.Provider,
            { value: itemContext },
            content.props.children
          )
        )
      )
    }
    return dashboardRequire("react-dom/server").renderToStaticMarkup(
      react.createElement(Host)
    )
  }
  const assertTarget = (html, label) => {
    const labels = [
      ...html.matchAll(/<label\b([^>]*)>([^<]*)<\/label>/gu),
    ].filter((match) => match[2] === label)
    assert.equal(labels.length, 1)
    const target = labels[0][1].match(/\bfor="([^"]+)"/u)?.[1]
    assert.ok(target, "Native label must have a concrete for target")
    const buttons = [
      ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu),
    ].filter((match) => match[1].match(/\bid="([^"]+)"/u)?.[1] === target)
    assert.equal(
      buttons.length,
      1,
      "Native label must identify the real Select trigger"
    )
    assert.match(buttons[0][1], /\brole="combobox"/u)
    const labelId = labels[0][1].match(/\bid="([^"]+)"/u)?.[1]
    assert.ok(labelId)
    assert.equal(
      buttons[0][1].match(/\baria-labelledby="([^"]+)"/u)?.[1],
      labelId
    )
    assert.equal(
      [...html.matchAll(/\bid="([^"]+)"/gu)].filter(
        (match) => match[1] === target
      ).length,
      1
    )
  }
  return { render, markup, assertTarget, Form, react, ui }
}

for (const [lazy, component, fieldName, label, values, selected, texts] of [
  [
    "store-edit-W24ZGNNJ.mjs",
    "EditStoreForm",
    "default_currency_code",
    "Default currency",
    ["usd", "eur"],
    "usd",
    ["USD", "EUR"],
  ],
  [
    "region-create-UOKF5UOS.mjs",
    "CreateRegionForm",
    "currency_code",
    "Currency",
    ["USD", "EUR"],
    "USD",
    ["US Dollar", "Euro"],
  ],
  [
    "region-edit-KMTFCMZN.mjs",
    "EditRegionForm",
    "currency_code",
    "Currency",
    ["USD", "EUR"],
    "USD",
    ["USD", "EUR"],
  ],
]) {
  for (const entry of [lazy, "app.js"]) {
    test(`${entry} ${component}: native label identifies its real Select trigger and preserves currency state`, () => {
      const expression = nativeSelectField(entry, component, fieldName)
      const currencies = [
        { code: "USD", name: "US Dollar" },
        { code: "EUR", name: "Euro" },
      ]
      const harness = nativeSelectRenderContext(expression, {
        currencies,
        currencies2: currencies,
        store: {
          supported_currencies: [
            { currency_code: "usd" },
            { currency_code: "eur" },
          ],
        },
      })
      const changes = []
      const blur = () => {},
        ref = () => {}
      const onChange = (value) => changes.push(value)
      const tree = harness.render({
        field: {
          name: fieldName,
          value: selected,
          onChange,
          onBlur: blur,
          ref,
        },
      })
      const select = menuNodes(tree, harness.ui.Select)
      assert.equal(select.length, 1)
      assert.equal(select[0].props.value, selected)
      assert.equal(select[0].props.name, fieldName)
      assert.equal(select[0].props.dir, "ltr")
      assert.equal(select[0].props.onValueChange, onChange)
      const controls = menuNodes(tree, harness.Form.Control)
      assert.equal(controls.length, 1)
      assert.equal(controls[0].props.children.type, harness.ui.Select.Trigger)
      assert.equal(controls[0].props.children.ref, ref)
      assert.equal(menuNodes(controls[0], harness.ui.Select).length, 0)
      const options = menuNodes(tree, harness.ui.Select.Item)
      assert.deepEqual(
        options.map((option) => option.props.value),
        values
      )
      assert.deepEqual(
        options.map((option) => option.props.children),
        texts
      )
      select[0].props.onValueChange(values[1])
      assert.deepEqual(changes, [values[1]])
      harness.assertTarget(harness.markup(fieldName, tree), label, texts[0])
    })
  }
}

for (const entry of ["tax-region-province-create-CPXYTVAN.mjs", "app.js"]) {
  test(`${entry}: native ProvinceSelect forwards mounted label/control attributes to its real trigger`, () => {
    const ts = backendRequire("typescript")
    const parsed = ts.createSourceFile(
      entry,
      readFileSync(join(dashboardRoot, "dist", entry), "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const matches = []
    const visit = (node) => {
      const assigned =
        ts.isVariableDeclaration(node) &&
        node.name.getText(parsed) === "ProvinceSelect"
          ? node.initializer
          : ts.isBinaryExpression(node) &&
              node.left.getText(parsed) === "ProvinceSelect"
            ? node.right
            : null
      if (
        assigned &&
        ts.isCallExpression(assigned) &&
        assigned.expression.getText(parsed).includes("forwardRef") &&
        ts.isArrowFunction(assigned.arguments[0])
      )
        matches.push(assigned.arguments[0].getText(parsed))
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    assert.equal(matches.length, 1)
    const harness = nativeSelectRenderContext(matches[0], {
      getCountryProvinceObjectByIso2: (country) =>
        country === "ca"
          ? { type: "province", options: { ON: "Ontario", QC: "Quebec" } }
          : undefined,
    })
    const NativeProvince = harness.react.forwardRef(harness.render)
    const fieldName = "province_code"
    const label = harness.react.createElement(
      harness.Form.Label,
      {},
      "Province"
    )
    const control = harness.react.createElement(
      harness.Form.Control,
      {},
      harness.react.createElement(NativeProvince, {
        name: fieldName,
        country_code: "ca",
        value: "ON",
        onChange: () => {},
      })
    )
    const tree = harness.react.createElement(
      harness.Form.Item,
      {},
      label,
      control
    )
    harness.assertTarget(harness.markup(fieldName, tree), "Province", "Ontario")
    const proof = {
      id: "native-province-trigger",
      "aria-labelledby": "native-province-label",
      "aria-describedby": "native-province-help",
      "aria-invalid": true,
      "aria-label": "Owned province",
    }
    const Host = () =>
      harness.react.createElement(NativeProvince, {
        ...proof,
        name: fieldName,
        country_code: "ca",
        value: "ON",
        onChange: () => {},
      })
    const html = dashboardRequire("react-dom/server").renderToStaticMarkup(
      harness.react.createElement(Host)
    )
    const button = [...html.matchAll(/<button\b([^>]*)>/gu)].find((match) =>
      match[1].includes('id="native-province-trigger"')
    )
    assert.ok(button)
    for (const [name, value] of Object.entries(proof))
      assert.ok(
        button[1].includes(`${name}="${value}"`),
        `Native trigger must preserve ${name}`
      )
    assert.equal(
      [...html.matchAll(/\bid="native-province-trigger"/gu)].length,
      1
    )
  })
}

// Render each shipped NoRecords and NoResults implementation with native
// React 18, Medusa Text/Button and router links. Preserve empty-state semantics
// while guarding the real message class used by the observed dark-role failure.
const nativeEmptyStateHarness = (entry) => {
  const react = dashboardRequire("react")
  const ui = dashboardRequire("@medusajs/ui")
  const icons = dashboardRequire("@medusajs/icons")
  const router = dashboardRequire("react-router-dom")
  const { StaticRouter } = dashboardRequire("react-router-dom/server")
  const jsxRuntime = dashboardRequire("react/jsx-runtime")
  const translation = () => ({
    t: (key) =>
      ({
        "general.noRecordsTitle": "No records",
        "general.noRecordsMessage": "No records have been created.",
        "general.noResultsTitle": "No results",
        "general.noResultsMessage": "Change your search and try again.",
      })[key] ?? key,
  })
  const context = {
    ...react,
    ...ui,
    ...icons,
    ...router,
    ...jsxRuntime,
    Text: ui.Text,
    Button: ui.Button,
    clx: ui.clx,
    useTranslation: translation,
  }
  const expressions = Object.fromEntries(
    [
      "DefaultButton",
      "TransparentIconLeftButton",
      "NoRecords",
      "NoResults",
    ].map((name) => [name, nativeArrow(entry, name)])
  )
  for (const expression of Object.values(expressions)) {
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = jsxRuntime
      if (/^import_ui\d*$/u.test(token)) context[token] = ui
      if (/^import_icons\d*$/u.test(token)) context[token] = icons
      if (/^import_react_router_dom\d*$/u.test(token)) context[token] = router
      if (/^import_react_i18next\d*$/u.test(token))
        context[token] = { useTranslation: translation }
    }
  }
  for (const name of ["DefaultButton", "TransparentIconLeftButton"])
    context[name] = vm.runInNewContext(`(${expressions[name]})`, context)
  const components = Object.fromEntries(
    ["NoRecords", "NoResults"].map((name) => [
      name,
      vm.runInNewContext(`(${expressions[name]})`, context),
    ])
  )
  return {
    react,
    render: (name, props = {}) =>
      dashboardRequire("react-dom/server").renderToStaticMarkup(
        react.createElement(
          StaticRouter,
          { location: "/settings/roles/role_owned" },
          react.createElement(components[name], props)
        )
      ),
  }
}

for (const entry of ["chunk-EMIHDNB7.mjs", "app.js"]) {
  test(`${entry} native NoRecords: readable message preserves empty-table content and actions`, () => {
    const harness = nativeEmptyStateHarness(entry)
    const roleMessage = "This role doesn't have users."
    const encodedRoleMessage = roleMessage.replaceAll("'", "&#x27;")
    const html = harness.render("NoRecords", { message: roleMessage })
    assert.match(html, /h-\[150px\]/u)
    assert.match(html, /No records/u)
    assert.ok(html.includes(encodedRoleMessage))
    assert.equal([...html.matchAll(/<svg\b/gu)].length, 1)
    assert.equal([...html.matchAll(/<a\b/gu)].length, 0)
    assert.equal([...html.matchAll(/<button\b/gu)].length, 0)
    assert.ok(!html.includes('role="alert"'))
    const paragraphs = [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gu)]
    const message = paragraphs.filter(
      (match) => match[2] === encodedRoleMessage
    )
    assert.equal(message.length, 1)
    assert.doesNotMatch(message[0][1], /\baria-hidden="true"/u)

    const fallback = harness.render("NoRecords")
    assert.match(fallback, /No records have been created\./u)
    const custom = harness.render("NoRecords", {
      title: "No assigned users",
      message: roleMessage,
      className: "owned-empty-layout",
      action: {
        to: "/settings/roles/role_owned/add-users",
        label: "Add users",
      },
      icon: harness.react.createElement("span", {
        role: "img",
        "aria-label": "Owned empty illustration",
      }),
    })
    assert.match(custom, /owned-empty-layout/u)
    assert.match(custom, /No assigned users/u)
    assert.match(custom, /href="\/settings\/roles\/role_owned\/add-users"/u)
    assert.match(custom, /<button\b[^>]*>Add users<\/button>/u)
    assert.match(custom, /role="img" aria-label="Owned empty illustration"/u)
    assert.equal([...custom.matchAll(/<svg\b/gu)].length, 0)
    const transparent = harness.render("NoRecords", {
      message: roleMessage,
      buttonVariant: "transparentIconLeft",
      action: {
        to: "/settings/roles/role_owned/add-users",
        label: "Add users",
      },
    })
    assert.match(
      transparent,
      /href="\/settings\/roles\/role_owned\/add-users"/u
    )
    assert.match(transparent, /text-ui-fg-interactive/u)
    assert.match(transparent, /Add users/u)

    const results = harness.render("NoResults", {
      title: "No matching users",
      message: "Change the search filter.",
      className: "owned-results-layout",
    })
    assert.match(results, /h-\[400px\]/u)
    assert.match(results, /owned-results-layout/u)
    assert.match(results, /No matching users/u)
    const resultsMessage = [
      ...results.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gu),
    ].filter((match) => match[2] === "Change the search filter.")
    assert.equal(resultsMessage.length, 1)
    assert.match(resultsMessage[0][1], /\btext-ui-fg-subtle\b/u)
    assert.equal([...results.matchAll(/<a\b/gu)].length, 0)
    assert.equal([...results.matchAll(/<button\b/gu)].length, 0)
    // The observed real paragraph must use the same readable existing token
    // as native NoResults. Actual browser Axe remains a separate acceptance.
    assert.match(message[0][1], /\btext-ui-fg-subtle\b/u)
    assert.doesNotMatch(message[0][1], /\btext-ui-fg-muted\b/u)
  })
}

// Exercise both emitted FocusModal.Title forwarding callbacks and render their
// actual Radix Title with native React 18. Class names belong to caller styling;
// refs, arbitrary primitive props and heading semantics must stay intact.
for (const distribution of ["esm", "cjs"]) {
  test(`${distribution} native FocusModal.Title: forwards caller class with primitive props and ref`, () => {
    const uiRequire = createRequire(join(uiRoot, "package.json"))
    const react = uiRequire("react")
    const dialog = uiRequire("radix-ui").Dialog
    const entry = `${distribution}/components/focus-modal/focus-modal.js`
    const ts = backendRequire("typescript")
    const parsed = ts.createSourceFile(
      entry,
      readFileSync(join(uiRoot, "dist", entry), "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const matches = []
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(parsed) === "FocusModalTitle" &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(parsed).endsWith(".forwardRef") &&
        ts.isArrowFunction(node.initializer.arguments[0])
      )
        matches.push(node.initializer.arguments[0].getText(parsed))
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    assert.equal(matches.length, 1)
    const render = vm.runInNewContext(`(${matches[0]})`, {
      React: react,
      RadixDialog: dialog,
      radix_ui_1: { Dialog: dialog },
    })
    const ref = react.createRef()
    const clicked = () => "owned-title-click"
    const props = {
      id: "owned-modal-title",
      className: "owned-modal-heading text-ui-fg-base txt-large-plus",
      "aria-describedby": "owned-modal-description",
      "data-owned-context": "publication",
      onClick: clicked,
      children: "Readable native News title",
    }
    const element = render(props, ref)
    assert.equal(element.type, dialog.Title)
    assert.equal(element.ref, ref)
    assert.equal(element.props.id, props.id)
    assert.equal(element.props["aria-describedby"], props["aria-describedby"])
    assert.equal(
      element.props["data-owned-context"],
      props["data-owned-context"]
    )
    assert.equal(element.props.onClick, clicked)
    assert.equal(element.props.children, props.children)
    const childElement = render({ ...props, asChild: true }, ref)
    assert.equal(childElement.props.asChild, true)
    assert.equal(childElement.ref, ref)
    const unstyled = render({ children: "Unstyled title" }, ref)
    assert.equal(unstyled.props.className, undefined)
    assert.equal(unstyled.props.children, "Unstyled title")
    const Title = react.forwardRef(render)
    const html = uiRequire("react-dom/server").renderToStaticMarkup(
      react.createElement(
        dialog.Root,
        { open: true },
        react.createElement(Title, props)
      )
    )
    const headings = [...html.matchAll(/<h2\b([^>]*)>([^<]*)<\/h2>/gu)]
    assert.equal(headings.length, 1)
    assert.equal(headings[0][2], props.children)
    assert.match(headings[0][1], /\bid="owned-modal-title"/u)
    assert.match(
      headings[0][1],
      /\baria-describedby="owned-modal-description"/u
    )
    assert.match(headings[0][1], /\bdata-owned-context="publication"/u)
    assert.doesNotMatch(headings[0][1], /\baria-hidden="true"/u)
    // These assertions fail on the real shipped className-drop defect; no
    // fabricated Title or post-render DOM/style assignment is involved.
    assert.equal(element.props.className, props.className)
    assert.equal(childElement.props.className, props.className)
    assert.ok(headings[0][1].includes(`class="${props.className}"`))
  })
}

// Execute the shipped form against server pages; its emitted code owns the diff.
const nativeRolePolicyHarness = (entry, roleIds, failures = {}) => {
  const expression = nativeArrow(entry, "EditRolePermissionsForm")
  const calls = {
    queries: [],
    added: [],
    removed: [],
    errors: [],
    successes: 0,
  }
  const refs = []
  let state,
    refIndex = 0,
    effects = [],
    formPolicies = [...roleIds]
  let page = { offset: 0, ids: [], pending: false, error: null }
  const form = {
    setValue: (field, value) => {
      assert.equal(field, "policies")
      formPolicies = Array.from(value)
    },
    handleSubmit: (submit) => () => submit({ policies: [...formPolicies] }),
  }
  const react = {
    useMemo: (callback) => callback(),
    useState: (initial) => {
      state ??= { ...initial }
      return [
        state,
        (value) => {
          state = typeof value === "function" ? value(state) : value
        },
      ]
    },
    useRef: (initial) => {
      const index = refIndex++
      refs[index] ??= { current: initial }
      return refs[index]
    },
    useEffect: (callback) => effects.push(callback),
  }
  const useRbacAssignablePolicies = (query) => {
    calls.queries.push(query ? { ...query } : null)
    if (!query) {
      return {
        data: {
          policies: Array.from({ length: 20 }, (_, i) => ({
            id: "policy_" + i,
          })),
          count: 42,
        },
        isPending: false,
      }
    }
    assert.equal(query.limit, 20)
    assert.equal(query.offset, page.offset)
    return {
      data: { policies: page.ids.map((id) => ({ id })), count: 42 },
      isPending: page.pending,
      isError: !!page.error,
      error: page.error,
    }
  }
  const useAddRbacRolePolicies = (roleId) => {
    assert.equal(roleId, "role_owned")
    return {
      isPending: false,
      mutateAsync: async (body) => {
        calls.added.push(Array.from(body.policies))
        if (failures.add) throw failures.add
      },
    }
  }
  const useMutation = ({ mutationFn, onSuccess }) => ({
    isPending: false,
    mutateAsync: async (value) => {
      await mutationFn(value)
      await onSuccess?.()
    },
  })
  const ui = {
    Button: "role-button",
    toast: { error: (message) => calls.errors.push(message) },
  }
  const context = nativeSettingsContext(expression, {
    ...react,
    Error,
    useForm: () => form,
    zodResolver: () => undefined,
    EditRolePermissionsSchema: {},
    useRbacAssignablePolicies,
    useAddRbacRolePolicies,
    useMutation,
    keepPreviousData: "previous",
    Button: ui.Button,
    toast: ui.toast,
    useRouteModal: () => ({ handleSuccess: () => calls.successes++ }),
    useQueryParams: () => ({ offset: String(page.offset) }),
    usePolicyColumns: () => [],
    usePolicyColumns2: () => [],
    RouteDrawer: {
      Form: "role-form",
      Body: "role-body",
      Footer: "role-footer",
      Close: "role-close",
    },
    KeyboundForm: "role-keybound",
    DataTable: "role-table",
    sdk: {
      admin: {
        rbacRole: {
          removePolicy: async (roleId, policyId) => {
            assert.equal(roleId, "role_owned")
            calls.removed.push(policyId)
            if (failures.remove) throw failures.remove
          },
        },
      },
    },
    queryClient: { invalidateQueries: () => {} },
    rbacRolesQueryKeys: {
      policies: (id) => [id, "policies"],
      detail: (id) => [id, "detail"],
      lists: () => ["roles"],
    },
  })
  context.Button = ui.Button
  for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
    if (/^import_react\d*$/u.test(token)) context[token] = react
    if (/^import_react_hook_form\d*$/u.test(token))
      context[token] = { useForm: () => form }
    if (/^import_zod\d*$/u.test(token))
      context[token] = { zodResolver: () => undefined }
    if (/^import_ui\d*$/u.test(token)) context[token] = ui
    if (/^import_react_query\d*$/u.test(token))
      context[token] = { useMutation, keepPreviousData: "previous" }
    if (/^PAGE_SIZE\d*$/u.test(token)) context[token] = 20
    if (/^PREFIX\d*$/u.test(token)) context[token] = "rp"
  }
  const native = vm.runInNewContext("(" + expression + ")", context)
  let tree
  const render = (offset, ids, changes = {}) => {
    page = { offset, ids, pending: false, error: null, ...changes }
    refIndex = 0
    effects = []
    tree = native({
      role: { id: "role_owned", policies: roleIds.map((id) => ({ id })) },
    })
    return tree
  }
  const changeSelection = (update) => {
    const table = menuNodes(tree, "role-table")
    assert.equal(table.length, 1)
    table[0].props.rowSelection.onRowSelectionChange(update)
  }
  const submit = () => {
    const keybound = menuNodes(tree, "role-keybound")
    assert.equal(keybound.length, 1)
    return keybound[0].props.onSubmit()
  }
  const save = () =>
    menuNodes(tree, "role-button").find((node) => node.props.type === "submit")
  return {
    calls,
    render,
    changeSelection,
    submit,
    save,
    flushEffects: () => {
      const pending = effects
      effects = []
      pending.forEach((run) => run())
    },
    // Selection's retained first effect updates RHF, before the seen-page effect.
    flushSelectionEffect: () => effects.shift()?.(),
  }
}

for (const entry of ["role-permissions-NPOK4K7X.mjs", "app.js"]) {
  test(
    entry +
      ": native role policy removal beyond first20 preserves unseen sibling before page effect",
    async () => {
      const h = nativeRolePolicyHarness(entry, ["policy_late", "policy_hidden"])
      h.render(20, ["policy_late"])
      h.changeSelection((previous) => {
        const next = { ...previous }
        delete next.policy_late
        return next
      })
      h.render(20, ["policy_late"])
      h.flushSelectionEffect()
      await h.submit()
      assert.deepEqual(h.calls.removed, ["policy_late"])
      assert.deepEqual(h.calls.added, [])
      assert.equal(h.calls.successes, 1)
      assert.equal(h.calls.queries.filter((query) => query === null).length, 0)
    }
  )

  test(
    entry +
      ": native role policy removal retains previously visited page scope",
    async () => {
      const h = nativeRolePolicyHarness(entry, [
        "policy_visited",
        "policy_hidden",
      ])
      h.render(20, ["policy_visited"])
      h.flushEffects()
      h.changeSelection((previous) => {
        const next = { ...previous }
        delete next.policy_visited
        return next
      })
      h.render(40, ["policy_other"])
      h.flushEffects()
      await h.submit()
      assert.deepEqual(h.calls.removed, ["policy_visited"])
      assert.deepEqual(h.calls.added, [])
      assert.equal(h.calls.successes, 1)
    }
  )

  test(
    entry + ": native role policy selections persist across server pages",
    async () => {
      const h = nativeRolePolicyHarness(entry, ["policy_hidden"])
      h.render(0, ["policy_first"])
      h.flushEffects()
      h.changeSelection((previous) => ({ ...previous, policy_first: true }))
      h.render(0, ["policy_first"])
      h.flushEffects()
      h.render(20, ["policy_second"])
      h.flushEffects()
      h.changeSelection((previous) => ({ ...previous, policy_second: true }))
      h.render(20, ["policy_second"])
      h.flushEffects()
      await h.submit()
      assert.deepEqual(h.calls.added, [["policy_first", "policy_second"]])
      assert.deepEqual(h.calls.removed, [])
      assert.equal(h.calls.successes, 1)
    }
  )

  test(entry + ": native role policy pending page disables Save", () => {
    const h = nativeRolePolicyHarness(entry, ["policy_hidden"])
    h.render(20, ["policy_late"], { pending: true })
    assert.equal(h.save().props.disabled, true)
    assert.deepEqual(h.calls.added, [])
    assert.deepEqual(h.calls.removed, [])
    assert.equal(h.calls.successes, 0)
  })

  test(
    entry + ": native role policy page failure retains native error boundary",
    () => {
      const expected = new Error("Owned policy page failed")
      const h = nativeRolePolicyHarness(entry, ["policy_hidden"])
      assert.throws(
        () => h.render(20, [], { error: expected }),
        (error) => error === expected
      )
      assert.deepEqual(h.calls.added, [])
      assert.deepEqual(h.calls.removed, [])
      assert.equal(h.calls.successes, 0)
    }
  )

  test(
    entry + ": native role policy add failure stops removal and success",
    async () => {
      const h = nativeRolePolicyHarness(entry, ["policy_0", "policy_hidden"], {
        add: new Error("Owned policy add failed"),
      })
      h.render(0, ["policy_0", "policy_new"])
      h.flushEffects()
      h.changeSelection((previous) => {
        const next = { ...previous, policy_new: true }
        delete next.policy_0
        return next
      })
      h.render(0, ["policy_0", "policy_new"])
      h.flushEffects()
      await h.submit()
      assert.deepEqual(h.calls.added, [["policy_new"]])
      assert.deepEqual(h.calls.removed, [])
      assert.deepEqual(h.calls.errors, ["Owned policy add failed"])
      assert.equal(h.calls.successes, 0)
    }
  )

  test(
    entry + ": native role policy remove failure retains error and open drawer",
    async () => {
      const h = nativeRolePolicyHarness(entry, ["policy_0", "policy_hidden"], {
        remove: new Error("Owned policy remove failed"),
      })
      h.render(0, ["policy_0"])
      h.flushEffects()
      h.changeSelection((previous) => {
        const next = { ...previous }
        delete next.policy_0
        return next
      })
      h.render(0, ["policy_0"])
      h.flushEffects()
      await h.submit()
      assert.deepEqual(h.calls.added, [])
      assert.deepEqual(h.calls.removed, ["policy_0"])
      assert.deepEqual(h.calls.errors, ["Owned policy remove failed"])
      assert.equal(h.calls.successes, 0)
    }
  )
  test(
    entry +
      ": native role policy projected selection never strips an unseen sibling",
    async () => {
      const h = nativeRolePolicyHarness(entry, ["policy_0", "policy_hidden"])
      h.render(0, ["policy_0"])
      h.flushEffects()
      // A partial row-selection projection omits the hidden membership. Removal
      // remains scoped to policies actually returned by the server, not all IDs.
      h.changeSelection(() => ({}))
      h.render(0, ["policy_0"])
      h.flushEffects()
      await h.submit()
      assert.deepEqual(h.calls.removed, ["policy_0"])
      assert.deepEqual(h.calls.added, [])
      assert.equal(h.calls.successes, 1)
    }
  )
}

// Execute both shipped handlers; callback/promise and native Title ownership
// are regression evidence, not initialized authorization or browser acceptance.
const nativeFeedbackArrow = (entry, name) => nativeArrow(entry, name)
const nativeFeedbackContext = (expression, extra, ui, jsxRuntime) => {
  const context = nativeSettingsContext(expression, extra)
  // The generic factory fills bare/imported UI names. Restore the owned bindings
  // after it has run, including the genuine Heading used with Radix asChild.
  Object.assign(context, ui)
  for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
    if (/^import_ui\d*$/u.test(token)) context[token] = ui
    if (/^import_icons\d*$/u.test(token))
      context[token] = {
        PencilSquare: extra.PencilSquare,
        Trash: extra.Trash,
      }
    if (/^useTranslation\d*$/u.test(token))
      context[token] = extra.useTranslation
    if (/^import_react_i18next\d*$/u.test(token))
      context[token] = { useTranslation: extra.useTranslation }
    if (/^import_react_router_dom\d*$/u.test(token))
      context[token] = {
        useNavigate: extra.useNavigate,
        useParams: extra.useParams,
      }
    if (/^import_react_hook_form\d*$/u.test(token))
      context[token] = { useForm: extra.useForm }
    if (/^import_zod\d*$/u.test(token))
      context[token] = { zodResolver: extra.zodResolver }
    if (jsxRuntime && /^jsx\d*$|^jsxs\d*$/u.test(token))
      context[token] = token.startsWith("jsxs")
        ? jsxRuntime.jsxs
        : jsxRuntime.jsx
    if (jsxRuntime && /^import_jsx_runtime\d*$/u.test(token))
      context[token] = jsxRuntime
  }
  return context
}
const nativeFeedbackMutation = (calls, failure) => {
  let callbacks
  const begin = (body, options) => {
    calls.mutations.push(body)
    callbacks = options
    if (failure) options.onError(failure)
  }
  return {
    // TanStack's ordinary mutate returns void; mutateAsync propagates failure.
    // Both execute the exact native callback supplied by the shipped handler.
    mutate: (body, options) => {
      begin(body, options)
    },
    mutateAsync: async (body, options) => {
      begin(body, options)
      if (failure) throw failure
    },
    succeed: (response) => {
      assert.ok(callbacks)
      callbacks.onSuccess(response)
    },
  }
}
const nativeRoleFeedbackHarness = (entry, data, changes = {}) => {
  const expression = nativeFeedbackArrow(entry, "EditRoleForm")
  const calls = {
    mutations: [],
    errors: [],
    successes: [],
    navigations: 0,
    translations: [],
  }
  const mutation = nativeFeedbackMutation(calls, changes.failure)
  const translation = () => ({
    t: (key, values) => {
      calls.translations.push([key, values])
      return key
    },
  })
  let formOptions
  const form = { control: {}, handleSubmit: (submit) => () => submit(data) }
  const useForm = (options) => {
    formOptions = options
    return form
  }
  const ui = {
    Button: "feedback-button",
    Input: "feedback-input",
    Textarea: "feedback-textarea",
    toast: {
      error: (message) => calls.errors.push(message),
      success: (message) => calls.successes.push(message),
    },
  }
  const context = nativeFeedbackContext(
    expression,
    {
      useTranslation: translation,
      useForm,
      zodResolver: () => "native-resolver",
      EditRoleSchema: "native-schema",
      useRouteModal: () => ({ handleSuccess: () => calls.navigations++ }),
      useUpdateRbacRole: (id) => {
        assert.equal(id, "role_owned")
        return { ...mutation, isPending: changes.pending ?? false }
      },
      RouteDrawer: {
        Form: "feedback-form",
        Body: "feedback-body",
        Footer: "feedback-footer",
        Close: "feedback-close",
      },
      KeyboundForm: "feedback-keybound",
      Form: {
        Field: "feedback-field",
        Item: "feedback-item",
        Label: "feedback-label",
        Control: "feedback-control",
        ErrorMessage: "feedback-error",
      },
    },
    ui
  )
  const render = vm.runInNewContext("(" + expression + ")", context)
  const tree = render({
    role: { id: "role_owned", name: "Original role", description: null },
  })
  const keybound = menuNodes(tree, "feedback-keybound")
  assert.equal(keybound.length, 1)
  return {
    calls,
    tree,
    formOptions,
    submit: keybound[0].props.onSubmit,
    save: menuNodes(tree, "feedback-button").find(
      (node) => node.props.type === "submit"
    ),
    succeed: mutation.succeed,
  }
}
const nativeUserFeedbackHarness = (entry, changes = {}) => {
  const expression = nativeFeedbackArrow(entry, "UserGeneralSection")
  const calls = {
    mutations: [],
    errors: [],
    successes: [],
    navigations: [],
    prompts: [],
    translations: [],
  }
  const mutation = nativeFeedbackMutation(calls, changes.failure)
  const translation = () => ({
    t: (key, values) => {
      calls.translations.push([key, values])
      return key
    },
  })
  const prompt = async (options) => {
    calls.prompts.push(options)
    return changes.confirmed ?? true
  }
  const ui = {
    Heading: "feedback-heading",
    Container: "feedback-container",
    Text: "feedback-text",
    usePrompt: () => prompt,
    toast: {
      error: (message) => calls.errors.push(message),
      success: (message) => calls.successes.push(message),
    },
  }
  const context = nativeFeedbackContext(
    expression,
    {
      useTranslation: translation,
      useNavigate: () => (to) => calls.navigations.push(to),
      useDeleteUser: (id) => {
        assert.equal(id, "user_self")
        return mutation
      },
      ActionMenu: "feedback-actions",
      PencilSquare: "feedback-pencil",
      Trash: "feedback-trash",
    },
    ui
  )
  const render = vm.runInNewContext("(" + expression + ")", context)
  const tree = render({
    user: {
      id: "user_self",
      first_name: "Native",
      last_name: "Fixture",
      email: "native-fixture@example.invalid",
    },
  })
  const menus = menuNodes(tree, "feedback-actions")
  assert.equal(menus.length, 1)
  const actions = menus[0].props.groups.flatMap((group) => group.actions)
  const deletion = actions.filter((action) => action.label === "actions.delete")
  assert.equal(deletion.length, 1)
  return {
    calls,
    tree,
    actions,
    remove: deletion[0].onClick,
    succeed: mutation.succeed,
  }
}
const nativeRoleTitleFeedbackHarness = (entry) => {
  const expression = nativeFeedbackArrow(entry, "RoleEdit")
  const react = dashboardRequire("react")
  const ui = dashboardRequire("@medusajs/ui")
  const jsxRuntime = dashboardRequire("react/jsx-runtime")
  const dialog = dashboardRequire("radix-ui").Dialog
  const queries = []
  const Form = () => null
  let current = { role: { id: "role_owned" }, isPending: false, isError: false }
  const context = nativeFeedbackContext(
    expression,
    {
      useTranslation: () => ({ t: (key) => key }),
      useParams: () => ({ id: "role_owned" }),
      useRbacRole: (id, query) => {
        queries.push([id, { ...query }])
        return current
      },
      RouteDrawer: ui.Drawer,
      EditRoleForm: Form,
    },
    ui,
    jsxRuntime
  )
  const native = vm.runInNewContext("(" + expression + ")", context)
  return {
    ui,
    Form,
    queries,
    render: (changes = {}) => {
      current = {
        role: { id: "role_owned" },
        isPending: false,
        isError: false,
        ...changes,
      }
      return native()
    },
    renderHeader: (header) =>
      dashboardRequire("react-dom/server").renderToStaticMarkup(
        react.createElement(
          ui.Drawer,
          { open: true },
          react.createElement(
            dialog.Content,
            { forceMount: true, "aria-describedby": undefined },
            header
          )
        )
      ),
  }
}
for (const entry of ["role-edit-6I7HWKNE.mjs", "app.js"]) {
  test(
    entry +
      ": native mutation feedback role failure keeps toast and resolves UI event promise",
    async () => {
      const failure = Object.assign(new Error("Native role update failed"), {
        status: 400,
      })
      const h = nativeRoleFeedbackHarness(
        entry,
        { name: "  Owned role  ", description: "  Native description  " },
        { failure }
      )
      await assert.doesNotReject(() => h.submit())
      assert.equal(h.calls.mutations.length, 1)
      assert.deepEqual(JSON.parse(JSON.stringify(h.calls.mutations[0])), {
        name: "Owned role",
        description: "Native description",
      })
      assert.deepEqual(h.calls.errors, [failure.message])
      assert.deepEqual(h.calls.successes, [])
      assert.equal(h.calls.navigations, 0)
    }
  )
  test(
    entry +
      ": native mutation feedback role navigates only from success callback",
    async () => {
      const h = nativeRoleFeedbackHarness(entry, {
        name: " Updated role ",
        description: " Native description ",
      })
      await h.submit()
      assert.equal(h.calls.mutations.length, 1)
      assert.deepEqual(h.calls.errors, [])
      assert.deepEqual(h.calls.successes, [])
      assert.equal(h.calls.navigations, 0)
      h.succeed({ role: { name: "Saved native role" } })
      assert.deepEqual(h.calls.successes, ["roles.edit.successToast"])
      assert.equal(h.calls.navigations, 1)
      const toastTranslation = h.calls.translations.find(
        ([key]) => key === "roles.edit.successToast"
      )
      assert.equal(toastTranslation[1].name, "Saved native role")
    }
  )
  test(
    entry +
      ": native mutation feedback role retains blank-description and pending contracts",
    async () => {
      const h = nativeRoleFeedbackHarness(
        entry,
        { name: " Owned role ", description: "  " },
        { pending: true }
      )
      assert.equal(h.save.type, "feedback-button")
      assert.equal(h.save.props.type, "submit")
      assert.equal(h.save.props.isLoading, true)
      assert.deepEqual(
        JSON.parse(JSON.stringify(h.formOptions.defaultValues)),
        { name: "Original role", description: "" }
      )
      assert.equal(h.formOptions.resolver, "native-resolver")
      await h.submit()
      assert.deepEqual(JSON.parse(JSON.stringify(h.calls.mutations[0])), {
        name: "Owned role",
        description: null,
      })
      assert.deepEqual(h.calls.errors, [])
      assert.equal(h.calls.navigations, 0)
    }
  )
  test(
    entry +
      ": native mutation feedback role edit retains genuine Radix title ID",
    () => {
      const h = nativeRoleTitleFeedbackHarness(entry)
      const tree = h.render()
      assert.equal(tree.type, h.ui.Drawer)
      const headers = menuNodes(tree, h.ui.Drawer.Header)
      assert.equal(headers.length, 1)
      const title = headers[0].props.children
      assert.equal(title.type, h.ui.Drawer.Title)
      assert.equal(title.props.asChild, true)
      assert.equal(title.props.children.type, h.ui.Heading)
      assert.equal(title.props.children.props.children, "roles.edit.header")
      const html = h.renderHeader(headers[0])
      const heading = [
        ...html.matchAll(/<h[1-6]\b([^>]*)>roles\.edit\.header<\/h[1-6]>/gu),
      ]
      assert.equal(heading.length, 1)
      const headingId = heading[0][1].match(/\bid="([^"]+)"/u)?.[1]
      assert.ok(headingId)
      const content = html.match(/<[^>]+\brole="dialog"[^>]*>/u)?.[0]
      assert.ok(content)
      assert.equal(
        content.match(/\baria-labelledby="([^"]+)"/u)?.[1],
        headingId
      )
      assert.deepEqual(JSON.parse(JSON.stringify(h.queries)), [
        ["role_owned", { fields: "id,name,description" }],
      ])
    }
  )
  test(
    entry +
      ": native mutation feedback role title preserves pending and read errors",
    () => {
      const h = nativeRoleTitleFeedbackHarness(entry)
      assert.equal(menuNodes(h.render({ isPending: true }), h.Form).length, 0)
      assert.equal(menuNodes(h.render({ role: null }), h.Form).length, 0)
      assert.equal(menuNodes(h.render(), h.Form).length, 1)
      const failure = new Error("Native role read failed")
      assert.throws(
        () => h.render({ isError: true, error: failure }),
        (error) => error === failure
      )
    }
  )
}
for (const entry of ["user-detail-2NP6KKH3.mjs", "app.js"]) {
  test(
    entry +
      ": native mutation feedback self-delete400 keeps toast and resolves UI event promise",
    async () => {
      const failure = Object.assign(
        new Error("Cannot delete the current native user"),
        { status: 400 }
      )
      const h = nativeUserFeedbackHarness(entry, { failure })
      await assert.doesNotReject(() => h.remove())
      assert.equal(h.calls.prompts.length, 1)
      assert.equal(h.calls.mutations.length, 1)
      assert.equal(h.calls.mutations[0], undefined)
      assert.deepEqual(h.calls.errors, [failure.message])
      assert.deepEqual(h.calls.successes, [])
      assert.deepEqual(h.calls.navigations, [])
    }
  )
  test(
    entry +
      ": native mutation feedback cancelled user confirmation never mutates",
    async () => {
      const h = nativeUserFeedbackHarness(entry, { confirmed: false })
      await assert.doesNotReject(() => h.remove())
      assert.equal(h.calls.prompts.length, 1)
      assert.deepEqual(h.calls.mutations, [])
      assert.deepEqual(h.calls.errors, [])
      assert.deepEqual(h.calls.successes, [])
      assert.deepEqual(h.calls.navigations, [])
      assert.equal(
        h.actions.find((action) => action.label === "actions.edit").to,
        "edit"
      )
    }
  )
  test(
    entry +
      ": native mutation feedback user prompt and success-only navigation remain native",
    async () => {
      const h = nativeUserFeedbackHarness(entry)
      await h.remove()
      assert.equal(h.calls.mutations.length, 1)
      assert.equal(h.calls.mutations[0], undefined)
      assert.equal(h.calls.prompts.length, 1)
      assert.deepEqual(JSON.parse(JSON.stringify(h.calls.prompts[0])), {
        title: "general.areYouSure",
        description: "users.deleteUserWarning",
        verificationText: "Native Fixture",
        verificationInstruction: "general.typeToConfirm",
        confirmText: "actions.delete",
        cancelText: "actions.cancel",
      })
      assert.deepEqual(h.calls.successes, [])
      assert.deepEqual(h.calls.navigations, [])
      h.succeed()
      assert.deepEqual(h.calls.successes, ["users.deleteUserSuccess"])
      assert.deepEqual(h.calls.navigations, [".."])
      assert.deepEqual(h.calls.errors, [])
      const toastTranslation = h.calls.translations.find(
        ([key]) => key === "users.deleteUserSuccess"
      )
      assert.equal(toastTranslation[1].name, "native-fixture@example.invalid")
    }
  )
}

// Exercise the actual native resolver, protected mount and filter/sort controls.
// Native API authorization and the initialized browser matrix remain separate.
const nativeLoadingAuditArrow = (entry, name) => nativeArrow(entry, name)
const nativeLoadingAuditContext = (expression, extra, ui = {}, jsxRuntime) => {
  const context = nativeSettingsContext(expression, extra)
  Object.assign(context, extra, ui)
  for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
    if (/^import_ui\d*$/u.test(token)) context[token] = ui
    if (/^(?:Text|IconButton|DropdownMenu)\d*$/u.test(token))
      context[token] = ui[token.replace(/\d+$/u, "")]
    if (/^import_icons\d*$/u.test(token)) context[token] = extra.icons
    if (/^(?:XMarkMini|DescendingSorting)\d*$/u.test(token))
      context[token] = extra.icons?.[token.replace(/\d+$/u, "")]
    if (/^import_react\d*$/u.test(token))
      context[token] = {
        useMemo: (callback) => callback(),
        useState: extra.useState,
      }
    if (/^useMemo\d*$/u.test(token)) context[token] = (callback) => callback()
    if (/^useTranslation\d*$/u.test(token))
      context[token] = extra.useTranslation
    if (/^import_react_i18next\d*$/u.test(token))
      context[token] = { useTranslation: extra.useTranslation }
    if (/^import_react_router_dom\d*$/u.test(token))
      context[token] = extra.router
    if (/^Outlet\d*$/u.test(token)) context[token] = extra.router?.Outlet
    if (/^Navigate\d*$/u.test(token)) context[token] = extra.router?.Navigate
    if (/^import_radix_ui\d*$/u.test(token)) context[token] = extra.radix
    if (/^RadixPopover\d*$/u.test(token)) context[token] = extra.radix?.Popover
    if (jsxRuntime && /^jsx\d*$|^jsxs\d*$/u.test(token))
      context[token] = token.startsWith("jsxs")
        ? jsxRuntime.jsxs
        : jsxRuntime.jsx
    if (jsxRuntime && /^import_jsx_runtime\d*$/u.test(token))
      context[token] = jsxRuntime
  }
  return context
}
const nativeLoadingGuardHarness = (entry) => {
  const expression = nativeLoadingAuditArrow(entry, "RoutePermissionGuard")
  const resolver = vm.runInNewContext(
    "(" + nativeLoadingAuditArrow(entry, "readRequirementFromHandle") + ")",
    {}
  )
  const calls = { registered: [], access: [] }
  let matches = [],
    loading = false,
    grants = new Set()
  const router = {
    Outlet: "native-outlet",
    Navigate: "native-navigate",
    useMatches: () => matches,
  }
  const check = (kind, permissions) => {
    calls.access.push([kind, Array.from(permissions)])
    return kind === "all"
      ? permissions.every((key) => grants.has(key))
      : permissions.some((key) => grants.has(key))
  }
  const context = nativeLoadingAuditContext(expression, {
    router,
    useMatches: router.useMatches,
    usePermissions: () => ({
      isLoading: loading,
      hasAllPermissions: (permissions) => check("all", permissions),
      hasAnyPermission: (permissions) => check("any", permissions),
    }),
    useRegisterPermissions: (permissions, options) =>
      calls.registered.push([
        permissions && Array.from(permissions),
        { ...options },
      ]),
    readRequirementFromHandle: resolver,
    AccessDenied: "native-access-denied",
  })
  const native = vm.runInNewContext("(" + expression + ")", context)
  return {
    calls,
    resolver,
    render: (handles, changes = {}) => {
      matches = handles.map((handle) => ({ handle }))
      loading = changes.loading ?? false
      grants = new Set(changes.grants ?? [])
      return native()
    },
  }
}
for (const entry of ["chunk-QIJSUXW3.mjs", "app.js"]) {
  test(
    entry +
      ": native loading controls declared requirement never mounts protected Outlet while pending",
    () => {
      const h = nativeLoadingGuardHarness(entry)
      assert.equal(
        h.render([{ permissions: "rbac_role:create" }, {}], {
          loading: true,
          grants: ["rbac_role:create"],
        }),
        null
      )
      assert.deepEqual(h.calls.registered, [
        [["rbac_role:create"], { requireAll: true, source: "route" }],
      ])
      assert.deepEqual(h.calls.access, [])
    }
  )
  test(
    entry +
      ": native loading controls explicit opt-out still renders Outlet while pending",
    () => {
      const h = nativeLoadingGuardHarness(entry)
      assert.equal(
        h.render([{}, undefined], { loading: true }).type,
        "native-outlet"
      )
      assert.deepEqual(h.calls.registered, [
        [null, { requireAll: false, source: "route" }],
      ])
      assert.deepEqual(h.calls.access, [])
    }
  )
  test(
    entry +
      ": native loading controls deepest declared requirement and registration remain native",
    () => {
      const h = nativeLoadingGuardHarness(entry)
      const tree = h.render(
        [
          { permissions: "parent:read" },
          { permissions: ["child:read", "child:update"] },
          {},
        ],
        { grants: ["child:read", "child:update"] }
      )
      assert.equal(tree.type, "native-outlet")
      assert.deepEqual(h.calls.access, [
        ["all", ["child:read", "child:update"]],
      ])
      assert.deepEqual(h.calls.registered, [
        [["child:read", "child:update"], { requireAll: true, source: "route" }],
      ])
    }
  )
  test(
    entry +
      ": native loading controls ALL and ANY retain actual access decisions",
    () => {
      const h = nativeLoadingGuardHarness(entry)
      const permissions = ["rbac_role:create", "rbac_role:read"]
      const denied = h.render([{ permissions }], { grants: ["rbac_role:read"] })
      assert.equal(denied.type, "native-access-denied")
      assert.equal(denied.props.requirement.requireAll, true)
      assert.equal(
        h.render([{ permissions, requireAll: false }], {
          grants: ["rbac_role:read"],
        }).type,
        "native-outlet"
      )
      assert.equal(
        h.render([{ permissions, requireAll: false }]).type,
        "native-access-denied"
      )
      assert.deepEqual(
        h.calls.access.map(([kind]) => kind),
        ["all", "any", "any"]
      )
    }
  )
  test(
    entry +
      ": native loading controls denied redirect replaces without mounting Outlet",
    () => {
      const h = nativeLoadingGuardHarness(entry)
      const tree = h.render([
        { permissions: "rbac_role:create", redirectTo: "/app/settings/roles" },
      ])
      assert.equal(tree.type, "native-navigate")
      assert.equal(tree.props.to, "/app/settings/roles")
      assert.equal(tree.props.replace, true)
      assert.deepEqual(h.calls.access, [["all", ["rbac_role:create"]]])
    }
  )
  test(
    entry +
      ": native loading controls requirement resolver preserves scalar array and empty contracts",
    () => {
      const h = nativeLoadingGuardHarness(entry)
      const plain = (value) => JSON.parse(JSON.stringify(value))
      assert.deepEqual(plain(h.resolver({ permissions: "user:read" })), {
        permissions: ["user:read"],
        requireAll: true,
      })
      assert.deepEqual(
        plain(
          h.resolver({
            permissions: ["user:read", "user:update"],
            requireAll: false,
            redirectTo: "/app",
          })
        ),
        {
          permissions: ["user:read", "user:update"],
          requireAll: false,
          redirectTo: "/app",
        }
      )
      assert.equal(h.resolver({ permissions: [] }), undefined)
      assert.equal(h.resolver({}), undefined)
      assert.equal(h.resolver(null), undefined)
    }
  )
}
const nativeFilterChipAuditHarness = (entry) => {
  const expression = nativeLoadingAuditArrow(entry, "FilterChip")
  const react = dashboardRequire("react")
  const jsxRuntime = dashboardRequire("react/jsx-runtime")
  const ui = dashboardRequire("@medusajs/ui")
  const radix = dashboardRequire("radix-ui")
  const icons = dashboardRequire("@medusajs/icons")
  const translated = []
  const useTranslation = () => ({
    t: (key) => {
      translated.push(key)
      return { "actions.remove": "Remove", "general.is": "is" }[key] ?? key
    },
  })
  const context = nativeLoadingAuditContext(
    expression,
    { radix, icons, useTranslation },
    ui,
    jsxRuntime
  )
  const native = vm.runInNewContext("(" + expression + ")", context)
  return {
    ui,
    radix,
    translated,
    tree: (props) => native(props),
    html: (props) =>
      dashboardRequire("react-dom/server").renderToStaticMarkup(
        react.createElement(
          radix.Popover.Root,
          null,
          react.createElement(native, props)
        )
      ),
  }
}
for (const entry of ["chunk-XRM7PIRS.mjs", "app.js"]) {
  test(
    entry +
      ": native loading controls filter value is a genuine named button through native Text Slot",
    () => {
      const h = nativeFilterChipAuditHarness(entry)
      const props = {
        label: "Created at",
        value: "Last 30 days",
        hasOperator: true,
        onRemove: () => {},
      }
      const tree = h.tree(props)
      const triggers = menuNodes(tree, h.radix.Popover.Trigger)
      assert.equal(triggers.length, 1)
      const text = triggers[0].props.children
      assert.equal(text.type, h.ui.Text)
      assert.equal(text.props.asChild, true)
      const button = text.props.children
      assert.equal(button.type, "button")
      assert.equal(button.props.type, "button")
      assert.equal(button.props["aria-label"], "Created at: Last 30 days")
      const html = h.html(props)
      const buttons = [
        ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu),
      ]
      const value = buttons.filter((match) =>
        match[1].includes('aria-label="Created at: Last 30 days"')
      )
      assert.equal(value.length, 1)
      assert.match(value[0][1], /\btype="button"/u)
      assert.match(value[0][1], /\baria-haspopup="dialog"/u)
      assert.match(value[0][1], /\baria-expanded="false"/u)
      assert.equal(value[0][2], "Last 30 days")
      assert.doesNotMatch(value[0][1], /\bdisabled(?:=|\s)/u)
    }
  )
  test(
    entry +
      ": native loading controls filter removal is translated typed and calls existing callback once",
    () => {
      const h = nativeFilterChipAuditHarness(entry)
      let removed = 0,
        stopped = 0
      const tree = h.tree({
        label: "Created at",
        value: "Last 30 days",
        onRemove: () => removed++,
      })
      const remove = menuNodes(tree, "button").filter(
        (node) => node.props.onClick
      )
      assert.equal(remove.length, 1)
      assert.equal(remove[0].props.type, "button")
      assert.equal(remove[0].props["aria-label"], "Remove Created at")
      remove[0].props.onClick({ stopPropagation: () => stopped++ })
      assert.equal(stopped, 1)
      assert.equal(removed, 1)
      assert.ok(h.translated.includes("actions.remove"))
    }
  )
  test(
    entry +
      ": native loading controls readonly filter disables value and never renders removal",
    () => {
      const h = nativeFilterChipAuditHarness(entry)
      const props = {
        label: "Created at",
        hadPreviousValue: true,
        readonly: true,
        onRemove: () => assert.fail("Readonly removal must remain absent"),
      }
      const tree = h.tree(props)
      const buttons = menuNodes(tree, "button")
      assert.equal(buttons.length, 1)
      assert.equal(buttons[0].props.type, "button")
      assert.equal(buttons[0].props.disabled, true)
      assert.equal(buttons[0].props["aria-label"], "Created at")
      assert.equal(menuNodes(tree, h.radix.Popover.Anchor).length, 0)
      const html = h.html(props)
      const rendered = [
        ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu),
      ]
      assert.equal(rendered.length, 1)
      assert.match(rendered[0][1], /\bdisabled=""/u)
      assert.match(rendered[0][1], /\btype="button"/u)
      assert.match(rendered[0][1], /\baria-label="Created at"/u)
      assert.doesNotMatch(html, /Remove Created at/u)
    }
  )
}
const nativeOrderByAuditHarness = (entry, initialQuery, prefix) => {
  const expression = nativeLoadingAuditArrow(entry, "DataTableOrderBy")
  const initial = vm.runInNewContext(
    "(" + nativeLoadingAuditArrow(entry, "initState") + ")",
    {}
  )
  let searchParams = new URLSearchParams(initialQuery),
    state
  const calls = []
  const menu = Object.assign(() => {}, {
    Trigger: "sort-trigger",
    Content: "sort-content",
    RadioGroup: "sort-radio",
    RadioItem: "sort-item",
    Separator: "sort-separator",
    Label: "sort-label",
  })
  const ui = { DropdownMenu: menu, IconButton: "sort-button" }
  const useState = (value) => {
    state ??= value
    return [
      state,
      (update) => {
        state = typeof update === "function" ? update(state) : update
      },
    ]
  }
  const useSearchParams = () => [
    searchParams,
    (update) => {
      searchParams =
        typeof update === "function" ? update(searchParams) : update
      calls.push(searchParams.toString())
    },
  ]
  const context = nativeLoadingAuditContext(
    expression,
    {
      useState,
      useSearchParams,
      router: { useSearchParams },
      initState: initial,
      useTranslation: () => ({ t: (key) => key }),
      useDocumentDirection: () => "rtl",
      icons: { DescendingSorting: "native-sort-icon" },
    },
    ui
  )
  const native = vm.runInNewContext("(" + expression + ")", context)
  const keys = [
    { key: "created_at", label: "Created at" },
    { key: "updated_at", label: "Updated at" },
  ]
  return {
    menu,
    calls,
    params: () => searchParams,
    render: () => native({ keys, prefix }),
  }
}
for (const entry of ["chunk-HQKGZADC.mjs", "app.js"]) {
  test(
    entry +
      ": native loading controls local sort root is nonmodal with unchanged radio directions and selection",
    () => {
      const h = nativeOrderByAuditHarness(
        entry,
        "p_order=-created_at&q=owned",
        "p"
      )
      const tree = h.render()
      assert.equal(tree.type, h.menu)
      assert.equal(tree.props.modal, false)
      assert.equal(tree.props.dir, "rtl")
      const trigger = menuNodes(tree, "sort-trigger")
      assert.equal(trigger.length, 1)
      assert.equal(trigger[0].props.asChild, true)
      assert.equal(
        menuNodes(tree, "sort-button")[0].props["aria-label"],
        "Sort results"
      )
      const groups = menuNodes(tree, "sort-radio")
      assert.equal(groups.length, 2)
      assert.equal(groups[0].props.value, "created_at")
      assert.equal(groups[1].props.value, "desc")
      const items = menuNodes(tree, "sort-item")
      assert.deepEqual(
        items.map((node) => node.props.value),
        ["created_at", "updated_at", "asc", "desc"]
      )
      let prevented = 0
      for (const item of items)
        item.props.onSelect({ preventDefault: () => prevented++ })
      assert.equal(prevented, 4)
      assert.deepEqual(h.calls, [])
      assert.equal(menuNodes(tree, "sort-content")[0].props.align, "end")
    }
  )
  test(
    entry +
      ": native loading controls sort preserves native prefix query updates and clear semantics",
    () => {
      const h = nativeOrderByAuditHarness(
        entry,
        "p_order=-created_at&order=external&q=owned",
        "p"
      )
      menuNodes(h.render(), "sort-radio")[0].props.onValueChange("updated_at")
      assert.equal(h.params().get("p_order"), "-updated_at")
      assert.equal(h.params().get("order"), "external")
      assert.equal(h.params().get("q"), "owned")
      menuNodes(h.render(), "sort-radio")[1].props.onValueChange("asc")
      assert.equal(h.params().get("p_order"), "updated_at")
      menuNodes(h.render(), "sort-radio")[0].props.onValueChange("")
      assert.equal(h.params().has("p_order"), false)
      assert.equal(h.params().get("order"), "external")
      const bare = nativeOrderByAuditHarness(
        entry,
        "order=-created_at&p_order=protected&q=owned"
      )
      menuNodes(bare.render(), "sort-radio")[1].props.onValueChange("asc")
      assert.equal(bare.params().get("order"), "created_at")
      assert.equal(bare.params().get("p_order"), "protected")
      const empty = nativeOrderByAuditHarness(
        entry,
        "p_order=protected&q=owned"
      )
      menuNodes(empty.render(), "sort-radio")[1].props.onValueChange("desc")
      assert.equal(empty.params().has("order"), false)
      assert.equal(empty.params().get("p_order"), "protected")
      assert.equal(empty.params().get("q"), "owned")
    }
  )
}

// Native CSS and emitted controls are exercised directly. Browser Axe and
// initialized mutation acceptance remain separate gates.
const nativeContrastCssPath = join(dashboardRoot, "dist/app.css")
const nativeContrastFormPath = (entry) => join(dashboardRoot, "dist", entry)
// Only the actual native theme selectors :root and repeated .dark classes.
const nativeContrastRules = (
  css = readFileSync(nativeContrastCssPath, "utf8")
) =>
  [
    ...css.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/([^{}]+)\{([^{}]*)\}/gu),
  ].map(([, selectors, body]) => ({
    selectors: selectors
      .trim()
      .split(",")
      .map((value) => value.trim()),
    declarations: body.split(";").flatMap((declaration) => {
      const colon = declaration.indexOf(":")
      if (colon < 0) return []
      return [
        [
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).trim(),
        ],
      ]
    }),
  }))
const nativeContrastVariables = (dark, css) => {
  const variables = new Map()
  const winners = new Map()
  for (const [order, rule] of nativeContrastRules(css).entries()) {
    const matching = rule.selectors.filter(
      (selector) =>
        selector === ":root" || (dark && /^(?:\.dark)+$/u.test(selector))
    )
    if (!matching.length) continue
    const specificity = Math.max(
      ...matching.map((selector) =>
        selector === ":root"
          ? 10
          : (selector.match(/\.dark/gu)?.length ?? 0) * 10
      )
    )
    for (const [property, value] of rule.declarations) {
      if (!property.startsWith("--")) continue
      const previous = winners.get(property)
      if (
        !previous ||
        specificity > previous.specificity ||
        (specificity === previous.specificity && order > previous.order)
      ) {
        winners.set(property, { specificity, order })
        variables.set(property, value)
      }
    }
  }
  return variables
}
const nativeContrastRgba = (value, variables, visited = new Set()) => {
  const reference = value.match(/^var\((--[\w-]+)\)$/u)?.[1]
  if (reference) {
    assert.ok(!visited.has(reference), "Native color aliases must not cycle")
    assert.ok(variables.has(reference), "Native color aliases must resolve")
    return nativeContrastRgba(
      variables.get(reference),
      variables,
      new Set([...visited, reference])
    )
  }
  const rgba = value
    .match(/^rgba\(([^)]+)\)$/u)?.[1]
    ?.split(",")
    .map(Number)
  assert.equal(rgba?.length, 4)
  assert.ok(rgba.every(Number.isFinite))
  assert.ok(rgba.slice(0, 3).every((channel) => channel >= 0 && channel <= 255))
  assert.ok(rgba[3] >= 0 && rgba[3] <= 1)
  return rgba
}
const nativeContrastColors = (classes, dark, state = "normal") => {
  const variables = nativeContrastVariables(dark)
  const active = new Set(
    classes.split(/\s+/u).flatMap((name) => {
      const [prefix] = name.split(":")
      if (!name.includes(":")) return [`.${name}`]
      if (prefix === "hover" && ["hover", "pressed"].includes(state))
        return [`.${name.replaceAll(":", "\\:")}:hover`]
      if (prefix === "active" && state === "pressed")
        return [`.${name.replaceAll(":", "\\:")}:active`]
      if (prefix === "disabled" && state === "disabled")
        return [`.${name.replaceAll(":", "\\:")}:disabled`]
      return []
    })
  )
  const declarations = new Map()
  for (const rule of nativeContrastRules())
    if (rule.selectors.some((selector) => active.has(selector)))
      for (const [property, value] of rule.declarations)
        if (["color", "background-color"].includes(property))
          declarations.set(property, value)
  return Object.fromEntries(
    [...declarations].map(([property, value]) => [
      property,
      nativeContrastRgba(value, variables),
    ])
  )
}
const nativeContrastRatio = (foreground, background) => {
  assert.equal(background[3], 1)
  const color = foreground
    .slice(0, 3)
    .map(
      (channel, index) =>
        channel * foreground[3] + background[index] * (1 - foreground[3])
    )
  const luminance = (channels) =>
    channels
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4
      )
      .reduce(
        (total, channel, index) =>
          total + channel * [0.2126, 0.7152, 0.0722][index],
        0
      )
  const values = [luminance(color), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
const nativeContrastFormLabel = (entry) => {
  const ts = backendRequire("typescript")
  const source = readFileSync(nativeContrastFormPath(entry), "utf8")
  const parsed = ts.createSourceFile(
    entry,
    source,
    ts.ScriptTarget.Latest,
    true
  )
  const matches = []
  const visit = (node) => {
    const initializer = ts.isVariableDeclaration(node)
      ? node.initializer
      : ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? node.right
        : undefined
    if (
      initializer &&
      ts.isCallExpression(initializer) &&
      initializer.expression.getText(parsed).includes("forwardRef") &&
      ts.isArrowFunction(initializer.arguments[0]) &&
      initializer.arguments[0].getText(parsed).includes('"fields.optional"')
    )
      matches.push(initializer.arguments[0].getText(parsed))
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(matches.length, 1)
  const expression = matches[0]
  const react = dashboardRequire("react")
  const ui = dashboardRequire("@medusajs/ui")
  const icons = dashboardRequire("@medusajs/icons")
  const jsxRuntime = dashboardRequire("react/jsx-runtime")
  const translation = () => ({
    t: (key) => (key === "fields.optional" ? "Optional" : key),
  })
  const context = {
    ...react,
    ...ui,
    ...icons,
    ...jsxRuntime,
    Text: ui.Text,
    clx: ui.clx,
    LabelComponent: ui.Label,
    useTranslation: translation,
    useFormField: () => ({
      formLabelId: "native-description-label",
      formItemId: "native-description",
    }),
  }
  for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
    if (/^import_react\d*$/u.test(token)) context[token] = react
    if (/^import_ui\d*$/u.test(token)) context[token] = ui
    if (/^import_icons\d*$/u.test(token)) context[token] = icons
    if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = jsxRuntime
    if (/^import_react_i18next\d*$/u.test(token))
      context[token] = { useTranslation: translation }
  }
  const Label = react.forwardRef(vm.runInNewContext(`(${expression})`, context))
  return (optional) =>
    dashboardRequire("react-dom/server").renderToStaticMarkup(
      react.createElement(Label, { optional, children: "Description" })
    )
}
for (const entry of ["chunk-OBQI23QM.mjs", "app.js"]) {
  test(`${entry}: native optional FormLabel text meets light and dark contrast without changing label semantics`, () => {
    const render = nativeContrastFormLabel(entry)
    const required = render(false)
    assert.doesNotMatch(required, /Optional/u)
    const html = render(true)
    const labels = [...html.matchAll(/<label\b([^>]*)>Description<\/label>/gu)]
    assert.equal(labels.length, 1)
    assert.match(labels[0][1], /\bid="native-description-label"/u)
    assert.match(labels[0][1], /\bfor="native-description"/u)
    const marker = [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gu)].filter(
      (match) => match[2] === "(Optional)"
    )
    assert.equal(marker.length, 1)
    assert.doesNotMatch(marker[0][1], /aria-hidden|role="(?:alert|status)"/u)
    const classes = marker[0][1].match(/class="([^"]+)"/u)?.[1]
    assert.ok(classes)
    for (const dark of [false, true]) {
      const colors = nativeContrastColors(classes, dark)
      const background = nativeContrastRgba(
        "var(--bg-base)",
        nativeContrastVariables(dark)
      )
      assert.ok(
        nativeContrastRatio(colors.color, background) >= 4.5,
        `Native ${dark ? "dark" : "light"} optional text must meet 4.5:1`
      )
    }
  })
}
const nativeContrastButton = (distribution) => {
  const ts = backendRequire("typescript")
  const entry = `${distribution}/components/button/button.js`
  const source = readFileSync(join(uiRoot, "dist", entry), "utf8")
  const parsed = ts.createSourceFile(
    entry,
    source,
    ts.ScriptTarget.Latest,
    true
  )
  const matches = []
  let variants
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(parsed) === "buttonVariants"
    )
      variants = node.initializer.getText(parsed)
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(parsed) === "Button" &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isArrowFunction(node.initializer.arguments[0])
    )
      matches.push(node.initializer.arguments[0].getText(parsed))
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(matches.length, 1)
  assert.ok(variants)
  const uiRequire = createRequire(join(uiRoot, "package.json"))
  const react = uiRequire("react")
  const ui = dashboardRequire("@medusajs/ui")
  const cva = uiRequire("cva")
  const radix = uiRequire("radix-ui")
  const icons = uiRequire("@medusajs/icons")
  const context = {
    React: react,
    cva: cva.cva,
    cva_1: cva,
    clx: ui.clx,
    clx_1: { clx: ui.clx },
    Slot: radix.Slot,
    radix_ui_1: radix,
    Spinner: icons.Spinner,
    icons_1: icons,
  }
  context.buttonVariants = vm.runInNewContext(`(${variants})`, context)
  const render = vm.runInNewContext(`(${matches[0]})`, context)
  return {
    react,
    render,
    markup: (element) =>
      uiRequire("react-dom/server").renderToStaticMarkup(element),
  }
}
for (const distribution of ["esm", "cjs"]) {
  for (const state of ["normal", "hover", "pressed"]) {
    test(`${distribution}: native primary Button ${state} meets enabled light and dark contrast`, () => {
      const h = nativeContrastButton(distribution)
      const click = () => "native-click"
      const ref = h.react.createRef()
      const element = h.render(
        {
          type: "submit",
          children: "Save",
          onClick: click,
          "aria-label": "Save role",
        },
        ref
      )
      assert.equal(element.type, "button")
      assert.equal(element.props.type, "submit")
      assert.equal(element.props.disabled, false)
      assert.equal(element.props.onClick, click)
      assert.equal(element.ref, ref)
      assert.equal(element.props["aria-label"], "Save role")
      assert.equal(element.props.children, "Save")
      for (const dark of [false, true]) {
        const colors = nativeContrastColors(
          element.props.className,
          dark,
          state
        )
        if (!dark)
          assert.deepEqual(
            colors["background-color"],
            {
              normal: [39, 39, 42, 1],
              hover: [63, 63, 70, 1],
              pressed: [82, 82, 91, 1],
            }[state]
          )
        if (dark && state === "normal")
          assert.deepEqual(colors["background-color"], [82, 82, 91, 1])
        assert.deepEqual(colors.color, [255, 255, 255, 0.88])
        assert.ok(
          nativeContrastRatio(colors.color, colors["background-color"]) >= 4.5,
          `Native ${dark ? "dark" : "light"} enabled ${state} must meet 4.5:1`
        )
      }
    })
  }
  test(`${distribution}: native Button preserves loading disable and original disabled theme colors`, () => {
    const h = nativeContrastButton(distribution)
    for (const props of [{ disabled: true }, { isLoading: true }]) {
      const element = h.render(
        { type: "submit", children: "Save", ...props },
        h.react.createRef()
      )
      assert.equal(element.props.disabled, true)
      assert.equal(element.props.type, "submit")
      assert.match(h.markup(element), /<button\b[^>]*disabled=""/u)
      for (const [dark, foreground, background] of [
        [false, [161, 161, 170, 1], [244, 244, 245, 1]],
        [true, [82, 82, 91, 1], [39, 39, 42, 1]],
      ]) {
        const colors = nativeContrastColors(
          element.props.className,
          dark,
          "disabled"
        )
        assert.deepEqual(colors.color, foreground)
        assert.deepEqual(colors["background-color"], background)
      }
    }
    assert.equal(h.render({ children: "Save" }, null).props.disabled, false)
  })
}

// Exercise exported native Form identity after the real draft-order initializer,
// plus generated native theme order and real date/denial component contracts.
// Browser and current compiled-asset verification remain separate gates.
const nativeFormIntegrationRoot = dashboardRoot
const nativeFormIntegrationSource = (entry) =>
  readFileSync(join(nativeFormIntegrationRoot, "dist", entry), "utf8")
const nativeFormDefinition = (
  source,
  main = false,
  plugin = false,
  cjs = false
) => {
  const marker = plugin
    ? cjs
      ? "const Provider = reactHookForm.FormProvider;"
      : "const Provider = FormProvider;"
    : main
      ? "Provider2 = "
      : "var Provider = "
  const start = source.indexOf(marker)
  const symbol = plugin ? "Form$2" : "Form"
  const formStart = source.indexOf(
    `${symbol} = Object.assign(${main ? "Provider2" : "Provider"}`,
    start
  )
  const endMarker = main ? "\n    });" : "\n});"
  const end = source.indexOf(endMarker, formStart) + endMarker.length
  assert.ok(start >= 0 && formStart > start && end > formStart)
  return { definition: source.slice(start, end), symbol }
}
const nativeFormDefinitionContext = (definition) => {
  const react = dashboardRequire("react")
  const hookForm = dashboardRequire("react-hook-form")
  const ui = dashboardRequire("@medusajs/ui")
  const icons = dashboardRequire("@medusajs/icons")
  const jsxRuntime = dashboardRequire("react/jsx-runtime")
  const radix = dashboardRequire("radix-ui")
  const translation = () => ({
    t: (key) => (key === "fields.optional" ? "Optional" : key),
  })
  const context = {
    ...react,
    ...hookForm,
    ...ui,
    ...icons,
    ...jsxRuntime,
    React: react,
    react,
    reactHookForm: hookForm,
    ui,
    icons,
    jsxRuntime,
    radixUi: radix,
    Text: ui.Text,
    clx: ui.clx,
    LabelComponent: ui.Label,
    HintComponent: ui.Hint,
    Label$1: ui.Label,
    Hint$1: ui.Hint,
    Slot: radix.Slot,
    useTranslation: translation,
  }
  for (const token of new Set(definition.match(/[A-Za-z_$][\w$]*/gu))) {
    if (/^import_react\d*$/u.test(token)) context[token] = react
    if (/^import_react_hook_form\d*$/u.test(token)) context[token] = hookForm
    if (/^import_ui\d*$/u.test(token)) context[token] = ui
    if (/^import_icons\d*$/u.test(token)) context[token] = icons
    if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = jsxRuntime
    if (/^import_radix_ui\d*$/u.test(token)) context[token] = radix
    if (/^import_react_i18next\d*$/u.test(token))
      context[token] = { useTranslation: translation }
  }
  return { context, react, hookForm }
}
for (const [entry, pluginEntry] of [
  ["chunk-OBQI23QM.mjs", "index.mjs"],
  ["app.js", "index.js"],
]) {
  test(`${entry}: native exported Form survives the later genuine shared provider initializer`, () => {
    const native = nativeFormDefinition(
      nativeFormIntegrationSource(entry),
      entry === "app.js"
    )
    const plugin = nativeFormDefinition(
      readFileSync(
        join(draftOrderRoot, ".medusa/server/src/admin", pluginEntry),
        "utf8"
      ),
      false,
      true,
      pluginEntry.endsWith(".js")
    )
    const h = nativeFormDefinitionContext(native.definition + plugin.definition)
    const provider = h.hookForm.FormProvider
    const descriptors = Object.getOwnPropertyDescriptors(provider)
    try {
      const Form = vm.runInNewContext(
        `${native.definition}; ${native.symbol};`,
        h.context
      )
      const own = Object.fromEntries(
        ["Item", "Label", "Control", "Hint", "ErrorMessage", "Field"].map(
          (key) => [key, Form[key]]
        )
      )
      const pluginForm = vm.runInNewContext(
        `${plugin.definition}; ${plugin.symbol};`,
        nativeFormDefinitionContext(plugin.definition).context
      )
      assert.equal(pluginForm, provider)
      assert.notEqual(pluginForm.Label, own.Label)
      for (const [key, value] of Object.entries(own))
        assert.equal(
          Form[key],
          value,
          `Native ${key} must survive the later plugin initializer`
        )
      assert.notEqual(Form, provider)
      const methods = {
        control: {},
        formState: {},
        getValues: () => ({ description: "native value" }),
      }
      const child = h.react.createElement("input", { name: "description" })
      const forwarded = Form({ ...methods, children: child })
      assert.equal(forwarded.type, provider)
      for (const [key, value] of Object.entries(methods))
        assert.equal(forwarded.props[key], value)
      assert.equal(forwarded.props.children, child)
      assert.equal(own.Label.displayName, "Form.Label")
      assert.equal(own.Control.displayName, "Form.Control")
    } finally {
      for (const key of Reflect.ownKeys(provider))
        if (!Object.hasOwn(descriptors, key)) delete provider[key]
      Object.defineProperties(provider, descriptors)
    }
  })
}

// Run the actual bundled Medusa palette generator in class-dark mode. Its base
// rules are emitted after the Dashboard import by native writeCSSFile.
const nativeGeneratedPaletteCss = () => {
  const ts = backendRequire("typescript")
  const medusaRequire = createRequire(
    backendRequire.resolve("@medusajs/medusa")
  )
  const entry = medusaRequire.resolve("@medusajs/admin-bundler")
  const source = readFileSync(entry, "utf8")
  const parsed = ts.createSourceFile(
    entry,
    source,
    ts.ScriptTarget.Latest,
    true
  )
  const initializers = new Map()
  const generators = []
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ["colors", "effects", "typography", "components"].includes(
        node.name.getText(parsed)
      )
    ) {
      assert.ok(!initializers.has(node.name.getText(parsed)))
      initializers.set(
        node.name.getText(parsed),
        node.initializer.getText(parsed)
      )
    }
    if (
      ts.isFunctionExpression(node) &&
      node.name?.getText(parsed) === "medusaUi"
    )
      generators.push(node.getText(parsed))
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(initializers.size, 4)
  assert.equal(generators.length, 1)
  const context = Object.fromEntries(
    [...initializers].map(([key, expression]) => [
      key,
      vm.runInNewContext(`(${expression})`),
    ])
  )
  const rules = []
  vm.runInNewContext(
    `(${generators[0]})`,
    context
  )({
    addBase: (base) => rules.push(base),
    addComponents: () => {},
    config: (key, fallback) =>
      key === "darkMode" ? ["class", ".dark"] : fallback,
  })
  const themes = rules.flatMap((rule) =>
    Object.entries(rule).filter(([selector]) =>
      [":root", ".dark"].includes(selector)
    )
  )
  assert.equal(themes.length, 2)
  return themes
    .map(
      ([selector, declarations]) =>
        `${selector}{${Object.entries(declarations)
          .map(([key, value]) => `${key}:${value}`)
          .join(";")}}`
    )
    .join("\n")
}
for (const distribution of ["esm", "cjs"]) {
  for (const state of ["hover", "pressed"]) {
    test(`${distribution}: native primary Button ${state} survives later generated palette rules`, () => {
      const originalCss = nativeFormIntegrationSource("app.css")
      const generated = nativeGeneratedPaletteCss()
      const combined = `${originalCss}\n${generated}`
      const h = nativeContrastButton(distribution)
      const button = h.render({ type: "submit", children: "Save" }, null)
      assert.equal(button.type, "button")
      assert.equal(button.props.disabled, false)
      const variables = nativeContrastVariables(true, combined)
      const token =
        state === "hover"
          ? "--button-inverted-hover"
          : "--button-inverted-pressed"
      const foreground = nativeContrastRgba(
        "var(--contrast-fg-primary)",
        variables
      )
      const background = nativeContrastRgba(`var(${token})`, variables)
      assert.ok(
        nativeContrastRatio(foreground, background) >= 4.5,
        `Generated dark ${state} must retain readable native contrast`
      )
      const palette = nativeContrastVariables(true, generated)
      assert.deepEqual(
        nativeContrastRgba("var(--button-inverted)", variables),
        nativeContrastRgba("var(--button-inverted)", palette)
      )
      const light = nativeContrastVariables(false, combined)
      const nativeLight = nativeContrastVariables(false, generated)
      for (const key of [
        "--button-inverted",
        "--button-inverted-hover",
        "--button-inverted-pressed",
        "--bg-disabled",
        "--fg-disabled",
      ])
        assert.deepEqual(
          nativeContrastRgba(`var(${key})`, light),
          nativeContrastRgba(`var(${key})`, nativeLight)
        )
      for (const key of ["--bg-disabled", "--fg-disabled"])
        assert.deepEqual(
          nativeContrastRgba(`var(${key})`, variables),
          nativeContrastRgba(`var(${key})`, palette)
        )
      assert.match(
        button.props.className,
        new RegExp(
          `${state === "hover" ? "hover" : "active"}:bg-ui-button-inverted-${state}`
        )
      )
    })
  }
}

for (const entry of ["chunk-QIJSUXW3.mjs", "app.js"]) {
  test(`${entry}: native denial preserves exact required permissions with readable text`, () => {
    const expression = nativeArrow(
      entry,
      "AccessDenied",
      nativeFormIntegrationRoot
    )
    const react = dashboardRequire("react")
    const ui = dashboardRequire("@medusajs/ui")
    const icons = dashboardRequire("@medusajs/icons")
    const jsxRuntime = dashboardRequire("react/jsx-runtime")
    const permissions = ["admin:roles:write", "admin:users:read"]
    const t = (key, values) =>
      key === "permissions.accessDenied.requiredPermission"
        ? `Required permission: ${values.permission}`
        : key
    const context = nativeLoadingAuditContext(
      expression,
      { ...icons, icons, useTranslation: () => ({ t }) },
      ui,
      jsxRuntime
    )
    const render = vm.runInNewContext(`(${expression})`, context)
    const tree = render({ requirement: { permissions } })
    const html = dashboardRequire("react-dom/server").renderToStaticMarkup(tree)
    const required = [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gu)].find(
      (match) =>
        match[2] === "Required permission: admin:roles:write, admin:users:read"
    )
    assert.ok(required)
    assert.match(html, /<h2\b/u)
    assert.match(html, /bg-ui-bg-base/u)
    assert.doesNotMatch(required[1], /aria-hidden|role="(?:alert|status)"/u)
    const classes = required[1].match(/class="([^"]+)"/u)?.[1]
    assert.ok(classes)
    for (const dark of [false, true]) {
      const colors = nativeContrastColors(classes, dark)
      const background = nativeContrastRgba(
        "var(--bg-base)",
        nativeContrastVariables(dark)
      )
      assert.ok(nativeContrastRatio(colors.color, background) >= 4.5)
    }
    assert.deepEqual(permissions, ["admin:roles:write", "admin:users:read"])
    assert.equal(react.isValidElement(tree), true)
  })
}
for (const entry of ["chunk-XRM7PIRS.mjs", "app.js"]) {
  test(`${entry}: native date popover names its current filter and retains preset behavior`, () => {
    const expression = nativeArrow(
      entry,
      "DateFilter",
      nativeFormIntegrationRoot
    )
    const react = dashboardRequire("react")
    const ui = dashboardRequire("@medusajs/ui")
    const icons = dashboardRequire("@medusajs/icons")
    const radix = dashboardRequire("radix-ui")
    const jsxRuntime = dashboardRequire("react/jsx-runtime")
    const preset = {
      label: "Today",
      value: { $gte: "2026-10-09T00:00:00.000Z" },
    }
    const calls = { add: [], delete: [], remove: [], state: [] }
    let stateIndex = 0
    const state = (initial) => {
      const index = stateIndex++
      return [initial, (value) => calls.state.push([index, value])]
    }
    const chip = () => null
    const extra = {
      radix,
      icons,
      ...icons,
      useState: state,
      useTranslation: () => ({ t: (key) => key }),
      t: (key) => key,
      useDate: () => ({ getFullDate: ({ date }) => date.toISOString() }),
      useDataTableFilterContext: () => ({
        removeFilter: (key) => calls.remove.push(key),
      }),
      useSelectedParams: ({ param, prefix }) => {
        assert.equal(param, "created_at")
        assert.equal(prefix, "users")
        return {
          get: () => [JSON.stringify(preset.value)],
          add: (value) => calls.add.push(value),
          delete: () => calls.delete.push(true),
        }
      },
      usePresets: () => [preset],
      parseDateComparison: () => preset.value,
      getDateFromComparison: (value, key) =>
        value[key] ? new Date(value[key]) : undefined,
      isEqual: dashboardRequire("lodash.isequal"),
      filter_chip_default: chip,
      HTMLElement: class HTMLElement {},
      clearTimeout,
      setTimeout,
    }
    const context = nativeLoadingAuditContext(expression, extra, ui, jsxRuntime)
    for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
      if (/^import_lodash\d*$/u.test(token))
        context[token] = { default: extra.isEqual }
      if (/^clx\d*$/u.test(token)) context[token] = ui.clx
      if (/^import_i18next\d*$/u.test(token)) context[token] = { t: extra.t }
    }
    const render = vm.runInNewContext(`(${expression})`, context)
    const nodes = (node, type) => {
      if (!node || typeof node !== "object") return []
      return [
        ...(node.type === type ? [node] : []),
        ...react.Children.toArray(node.props?.children).flatMap((child) =>
          nodes(child, type)
        ),
      ]
    }
    for (const label of ["Created", "Created on date"]) {
      stateIndex = 0
      const tree = render({
        filter: { key: "created_at", label },
        prefix: "users",
        readonly: false,
        openOnMount: true,
      })
      assert.equal(tree.type, radix.Popover.Root)
      assert.equal(tree.props.modal, true)
      assert.equal(tree.props.open, true)
      const content = nodes(tree, radix.Popover.Content)
      assert.equal(content.length, 1)
      assert.equal(content[0].props["aria-label"], label)
      assert.equal(content[0].props["data-name"], "date_filter_content")
      assert.equal(content[0].props.align, "start")
      assert.equal(content[0].props.sideOffset, 8)
      assert.equal(content[0].props.collisionPadding, 24)
      const presets = nodes(content[0], "button").filter((node) =>
        react.Children.toArray(node.props.children).includes("Today")
      )
      assert.equal(presets.length, 1)
      assert.equal(presets[0].props.type, "button")
      presets[0].props.onClick()
      assert.equal(calls.add.at(-1), JSON.stringify(preset.value))
      assert.deepEqual(calls.state.at(-1), [1, false])
      const chips = nodes(tree, chip)
      assert.equal(chips.length, 1)
      assert.equal(chips[0].props.label, label)
      assert.equal(chips[0].props.value, "Today")
      chips[0].props.onRemove()
      assert.equal(calls.remove.at(-1), "created_at")
      assert.equal(calls.delete.at(-1), true)
      tree.props.onOpenChange(false)
      assert.deepEqual(calls.state.at(-2), [0, false])
      assert.deepEqual(calls.state.at(-1), [2, "Today"])
    }
    stateIndex = 0
    const readOnly = render({
      filter: { key: "created_at", label: "Created" },
      prefix: "users",
      readonly: true,
      openOnMount: true,
    })
    assert.equal(nodes(readOnly, radix.Popover.Content).length, 0)
    assert.equal(nodes(readOnly, chip)[0].props.readonly, true)
  })
}

// Actual native emitted ClearAllFilters and unchanged theme/removal contracts.
const nativeClearAllAuditHarness = (entry, query, prefix) => {
  const expression = nativeArrow(entry, "ClearAllFilters")
  const ui = dashboardRequire("@medusajs/ui")
  const jsx = dashboardRequire("react/jsx-runtime")
  const initial = new URLSearchParams(query)
  let current = initial
  const calls = []
  const useSearchParams = () => [
    current,
    (update) => {
      assert.equal(typeof update, "function")
      const next = update(current)
      assert.ok(next instanceof URLSearchParams)
      assert.notEqual(next, current)
      calls.push("query")
      current = next
    },
  ]
  const context = nativeSettingsContext(expression, {
    URLSearchParams,
    useDataTableFilterContext: () => ({
      removeAllFilters: () => calls.push("context"),
    }),
    useSearchParams2: useSearchParams,
    clx6: ui.clx,
    jsx6: jsx.jsx,
  })
  // Restore genuine JSX/UI bindings after the generic native context factory.
  for (const token of new Set(expression.match(/[A-Za-z_]\w*/gu))) {
    if (/^jsx\d*$|^jsxs\d*$/u.test(token))
      context[token] = token.startsWith("jsxs") ? jsx.jsxs : jsx.jsx
    if (/^import_jsx_runtime\d*$/u.test(token)) context[token] = jsx
    if (/^import_ui\d*$/u.test(token)) context[token] = ui
    if (/^import_react_router_dom\d*$/u.test(token))
      context[token] = { useSearchParams }
  }
  const native = vm.runInNewContext(`(${expression})`, context)
  return {
    initial,
    calls,
    params: () => current,
    render: () =>
      native({ filters: [{ key: "created_at" }, { key: "status" }], prefix }),
  }
}

for (const entry of ["chunk-XRM7PIRS.mjs", "app.js"]) {
  test(
    entry + ": native clear all removes only declared prefixed filters",
    () => {
      const h = nativeClearAllAuditHarness(
        entry,
        "owned_created_at=today&owned_status=active&created_at=external&status=external&owned_offset=20&q=owned&unlisted=retained",
        "owned"
      )
      const control = h.render()
      assert.equal(control.type, "button")
      assert.equal(control.props.type, "button")
      assert.equal(control.props.children, "Clear all")
      assert.equal(control.props.disabled, undefined)
      assert.ok(
        control.props.className
          .split(/\s+/u)
          .includes("hover:text-ui-fg-subtle")
      )
      assert.ok(
        control.props.className
          .split(/\s+/u)
          .includes("focus-visible:shadow-borders-focus")
      )
      control.props.onClick()
      assert.deepEqual(h.calls, ["query", "context"])
      assert.equal(h.params().has("owned_created_at"), false)
      assert.equal(h.params().has("owned_status"), false)
      assert.equal(h.params().get("created_at"), "external")
      assert.equal(h.params().get("status"), "external")
      assert.equal(h.params().get("owned_offset"), "20")
      assert.equal(h.params().get("q"), "owned")
      assert.equal(h.params().get("unlisted"), "retained")
      assert.equal(h.initial.get("owned_created_at"), "today")
      assert.equal(h.initial.get("owned_status"), "active")
    }
  )
  test(
    entry + ": native clear all preserves unrelated unprefixed query state",
    () => {
      const h = nativeClearAllAuditHarness(
        entry,
        "created_at=today&status=active&owned_created_at=external&owned_status=external&offset=20&q=owned&unlisted=retained"
      )
      h.render().props.onClick()
      assert.deepEqual(h.calls, ["query", "context"])
      assert.equal(h.params().has("created_at"), false)
      assert.equal(h.params().has("status"), false)
      assert.equal(h.params().get("owned_created_at"), "external")
      assert.equal(h.params().get("owned_status"), "external")
      assert.equal(h.params().get("offset"), "20")
      assert.equal(h.params().get("q"), "owned")
      assert.equal(h.params().get("unlisted"), "retained")
      assert.equal(h.initial.get("created_at"), "today")
      assert.equal(h.initial.get("status"), "active")
    }
  )
  test(
    entry +
      ": native clear all base text is readable in actual dark and light themes",
    () => {
      const h = nativeClearAllAuditHarness(entry, "created_at=today")
      const control = h.render()
      const classes = control.props.className.split(/\s+/u)
      assert.ok(classes.includes("text-ui-fg-subtle"))
      assert.equal(classes.includes("text-ui-fg-muted"), false)
      for (const dark of [false, true]) {
        const variables = nativeContrastVariables(dark)
        const background = nativeContrastRgba(
          variables.get("--bg-base"),
          variables
        )
        const base = nativeContrastColors(control.props.className, dark).color
        const hover = nativeContrastColors(
          control.props.className,
          dark,
          "hover"
        ).color
        assert.deepEqual(
          base,
          nativeContrastRgba(variables.get("--fg-subtle"), variables)
        )
        assert.deepEqual(hover, base)
        assert.ok(nativeContrastRatio(base, background) >= 4.5)
        // The correction intentionally uses the darker native light foreground.
        if (!dark) assert.deepEqual(base, [82, 82, 91, 1])
      }
      assert.deepEqual(h.calls, [])
    }
  )
}

// Exercise the emitted UI DataTable.Filter used by native Users. These are
// package contracts; the original browser checks remain separately required.
const nativeFilterDialogFixture = (distribution, label, onRemove) => {
  const actualUiRoot = join(
    dirname(backendRequire.resolve("@medusajs/ui")),
    "../.."
  )
  const { isDateComparisonOperator } = backendRequire(
    join(
      actualUiRoot,
      "dist/cjs/blocks/data-table/utils/is-date-comparison-operator.js"
    )
  )
  const isDateFilterProps = vm.runInNewContext(
    `(${nativeArrow(
      `${distribution}/blocks/data-table/components/data-table-filter.js`,
      "isDateFilterProps",
      uiRoot
    )})`
  )
  const value = { $gte: "2026-10-09T04:00:00.000Z" }
  const options = [{ label: "Today", value }]
  const metadata = { type: "date", label, options, format: "date" }
  const removed = []
  const updated = []
  const lookups = []
  const onUpdate = (next) => updated.push(next)
  const filter = nativeMenuHarness(
    distribution,
    "filter",
    {
      getFilterMeta: (id) => {
        lookups.push(id)
        return metadata
      },
      removeFilter: (id) => removed.push(id),
    },
    {
      isDateComparisonOperator,
      is_date_comparison_operator_1: { isDateComparisonOperator },
      isDateFilterProps,
      DataTableFilterDateContent: "date-content",
    }
  )
  const render = (properties = {}) =>
    filter({
      id: "created_at",
      filter: value,
      onUpdate,
      onRemove,
      ...properties,
    })
  return { render, value, options, removed, updated, lookups, onUpdate }
}

for (const distribution of ["esm", "cjs"]) {
  test(`${distribution}: native filter dialog names preserve translated metadata and fallback identity`, () => {
    const labels = [
      { label: "Created", expected: "Created" },
      { label: "Erstellt am", expected: "Erstellt am" },
      { label: "  Créé le  ", expected: "  Créé le  " },
      { label: undefined, expected: "created_at" },
      { label: null, expected: "created_at" },
      { label: "", expected: "created_at" },
      { label: "   ", expected: "created_at" },
      { label: { type: "label-node" }, expected: "created_at" },
    ]
    for (const { label, expected } of labels) {
      const fixture = nativeFilterDialogFixture(distribution, label)
      const tree = fixture.render({ isNew: true })
      const content = menuNodes(tree, "popover-content")
      assert.equal(content.length, 1)
      assert.equal(content[0].props["aria-label"], expected)
      assert.equal(tree.props.modal, true)
      assert.equal(tree.props.open, true)
      assert.deepEqual(fixture.lookups, ["created_at"])
      const dateContent = menuNodes(tree, "date-content")
      assert.equal(dateContent.length, 1)
      assert.equal(dateContent[0].props.id, "created_at")
      assert.equal(dateContent[0].props.filter, fixture.value)
      assert.equal(dateContent[0].props.options, fixture.options)
      assert.equal(dateContent[0].props.onUpdate, fixture.onUpdate)
      assert.deepEqual(fixture.updated, [])
      assert.deepEqual(fixture.removed, [])
    }
  })

  test(`${distribution}: native filter dialog preserves native update and removal callbacks`, () => {
    const callbackRemovals = []
    const fixture = nativeFilterDialogFixture(distribution, "Created", () => {
      callbackRemovals.push("owned-removal")
    })
    const tree = fixture.render()
    const dateContent = menuNodes(tree, "date-content")[0]
    const next = { $gte: "2026-10-08T04:00:00.000Z" }
    assert.equal(dateContent.props.filter, fixture.value)
    assert.equal(dateContent.props.options, fixture.options)
    assert.equal(dateContent.props.onUpdate, fixture.onUpdate)
    assert.deepEqual(fixture.updated, [])
    dateContent.props.onUpdate(next)
    assert.equal(fixture.updated[0], next)
    assert.equal(fixture.updated.length, 1)
    const remove = menuNodes(tree, "button").find(
      (node) => node.props["aria-label"] === "Remove: Created"
    )
    assert.ok(remove)
    assert.equal(remove.props.type, "button")
    remove.props.onClick()
    assert.deepEqual(callbackRemovals, ["owned-removal"])
    assert.deepEqual(fixture.removed, [])
    const ordinary = nativeFilterDialogFixture(distribution, "Created")
    const ordinaryTree = ordinary.render()
    menuNodes(ordinaryTree, "button")
      .find((node) => node.props["aria-label"] === "Remove: Created")
      .props.onClick()
    assert.deepEqual(ordinary.removed, ["created_at"])
    assert.deepEqual(ordinary.updated, [])
  })

  test(`${distribution}: native filter dialog preserves native focus open and close behavior`, () => {
    const fixture = nativeFilterDialogFixture(distribution, "Created")
    const tree = fixture.render({ isNew: true })
    const content = menuNodes(tree, "popover-content")[0]
    assert.equal(tree.props.modal, true)
    assert.equal(tree.props.open, true)
    assert.equal(content.props.align, "start")
    assert.equal(content.props.sideOffset, 8)
    assert.equal(content.props.collisionPadding, 16)
    assert.equal(content.props.hideWhenDetached, true)
    assert.equal(content.props.className, "bg-ui-bg-component p-0 outline-none")
    let focused = 0
    content.props.onOpenAutoFocus({
      currentTarget: {
        querySelector: (selector) => {
          assert.equal(
            selector,
            'input:not([type="hidden"]), [role="list"][tabindex="0"]'
          )
          return { focus: () => focused++ }
        },
      },
    })
    assert.equal(focused, 1)
    let prevented = 0
    content.props.onCloseAutoFocus({ preventDefault: () => prevented++ })
    assert.equal(prevented, 0)
    content.props.onInteractOutside({
      target: { closest: () => null },
      preventDefault: () => prevented++,
    })
    assert.equal(prevented, 0)
    content.props.onInteractOutside({
      target: {
        closest: (selector) => {
          assert.equal(selector, '[role="menuitem"]')
          return {}
        },
      },
      preventDefault: () => prevented++,
    })
    assert.equal(prevented, 1)
    tree.props.onOpenChange(false)
    assert.deepEqual(fixture.removed, [])
    const retained = fixture.render({ isNew: false })
    menuNodes(retained, "popover-content")[0].props.onOpenAutoFocus({
      currentTarget: {
        querySelector: () => {
          focused++
        },
      },
    })
    assert.equal(focused, 1)
    const empty = fixture.render({ filter: undefined, isNew: true })
    let emptyPrevented = 0
    menuNodes(empty, "popover-content")[0].props.onCloseAutoFocus({
      preventDefault: () => emptyPrevented++,
    })
    assert.equal(emptyPrevented, 1)
    empty.props.onOpenChange(false)
    assert.deepEqual(fixture.removed, ["created_at"])
  })
}

const nativeProductTagLoaderHarness = (entry, cachedResult) => {
  const queryCalls = []
  const apiCalls = []
  const result = { product_tags: [], count: 0, limit: 20, offset: 0 }
  const context = {
    URL,
    parseFilterParam: vm.runInNewContext(
      `(${nativeArrow(entry === "app.js" ? "app.js" : "chunk-3UMI3ISU.mjs", "parseFilterParam")})`
    ),
    productTagsQueryKeys: { list: (query) => ["product_tags", "list", query] },
    sdk: {
      admin: {
        productTag: {
          list: async (query) => {
            apiCalls.push(query)
            return result
          },
        },
      },
    },
    queryClient: {
      getQueryData: (key) => {
        queryCalls.push(key)
        return cachedResult
      },
      fetchQuery: (query) => query.queryFn(),
    },
  }
  context.productTagListQuery = vm.runInNewContext(
    `(${nativeArrow(entry, "productTagListQuery")})`,
    context
  )
  const load = vm.runInNewContext(
    `(${nativeArrow(entry, "productTagListLoader")})`,
    context
  )
  const schema = backendRequire(
    "@medusajs/medusa/api/admin/product-tags/validators"
  ).AdminGetProductTagsParams.strict()
  return { load, context, queryCalls, apiCalls, result, schema }
}

for (const entry of ["app.js", "product-tag-list-MGHXTRBC.mjs"]) {
  test(`Product Tags native loader ${entry} preserves empty editable filter without invalid API keys`, async () => {
    for (const placeholder of ['""', "null", "[]"]) {
      const h = nativeProductTagLoaderHarness(entry)
      const params = new URLSearchParams({
        ptag_value: placeholder,
        ptag_offset: "20",
        ptag_order: "-value",
      })
      const request = {
        url: `https://owned.invalid/app/settings/product-tags?${params}`,
      }
      const originalUrl = request.url
      assert.equal(await h.load({ request }), h.result)
      assert.equal(request.url, originalUrl)
      assert.equal(h.apiCalls.length, 1)
      const query = JSON.parse(JSON.stringify(h.apiCalls[0]))
      assert.deepEqual(query, { offset: 20, order: "-value" })
      assert.equal(h.schema.safeParse(query).success, true)
      assert.equal(
        new URL(request.url).searchParams.get("ptag_value"),
        placeholder
      )
    }
  })

  test(`Product Tags native loader ${entry} preserves value arrays date operators search and pagination`, async () => {
    const h = nativeProductTagLoaderHarness(entry)
    const params = new URLSearchParams({
      ptag_value: JSON.stringify(["tour", "limited"]),
      ptag_created_at: JSON.stringify({
        $gte: "2026-01-01T00:00:00.000Z",
        $lt: "2027-01-01T00:00:00.000Z",
      }),
      ptag_q: "owned tag",
      ptag_offset: "40",
      ptag_limit: "20",
      ptag_order: "-created_at",
      fields: "id,value",
    })
    await h.load({
      request: {
        url: `https://owned.invalid/app/settings/product-tags?${params}`,
      },
    })
    const query = JSON.parse(JSON.stringify(h.apiCalls[0]))
    assert.deepEqual(query, {
      value: ["tour", "limited"],
      created_at: {
        $gte: "2026-01-01T00:00:00.000Z",
        $lt: "2027-01-01T00:00:00.000Z",
      },
      q: "owned tag",
      offset: 40,
      limit: 20,
      order: "-created_at",
      fields: "id,value",
    })
    assert.equal(h.schema.safeParse(query).success, true)
  })

  test(`Product Tags native loader ${entry} retains native cache hit without issuing list request`, async () => {
    const cached = {
      product_tags: [{ id: "ptag_owned", value: "owned" }],
      count: 1,
    }
    const h = nativeProductTagLoaderHarness(entry, cached)
    assert.equal(
      await h.load({
        request: {
          url: "https://owned.invalid/app/settings/product-tags?value=%22owned%22",
        },
      }),
      cached
    )
    assert.equal(h.apiCalls.length, 0)
    assert.deepEqual(JSON.parse(JSON.stringify(h.queryCalls)), [
      ["product_tags", "list", { value: "owned" }],
    ])
  })

  test(`Product Tags native loader ${entry} retains malformed native shape and propagates API rejection`, async () => {
    const h = nativeProductTagLoaderHarness(entry)
    const nativeError = new Error("Native Product Tags validation rejection")
    h.context.sdk.admin.productTag.list = async (query) => {
      h.apiCalls.push(query)
      throw nativeError
    }
    const params = new URLSearchParams({
      value: JSON.stringify({ $gte: 3 }),
      ptag_unsupported_key: "retained",
      ptag___proto__: JSON.stringify({ value: "untrusted" }),
    })
    await assert.rejects(
      h.load({
        request: {
          url: `https://owned.invalid/app/settings/product-tags?${params}`,
        },
      }),
      (error) => error === nativeError
    )
    const query = JSON.parse(JSON.stringify(h.apiCalls[0]))
    assert.deepEqual(query, {
      value: { $gte: 3 },
      ptag_unsupported_key: "retained",
      ptag___proto__: { value: "untrusted" },
    })
    assert.equal(h.schema.safeParse(query).success, false)
  })
}

for (const entry of ["app.js", "product-tag-list-MGHXTRBC.mjs"]) {
  test(`Product Tags native loader ${entry} retains unknown empty keys and native strict rejection`, async () => {
    for (const key of [
      "unsupported_key",
      "ptag_unsupported_key",
      "ptag___proto__",
    ]) {
      for (const [encoded, expected] of [
        ["", ""],
        ['""', ""],
        ["null", null],
        ["[]", []],
      ]) {
        const h = nativeProductTagLoaderHarness(entry)
        const nativeError = new Error("Native unknown Product Tags query key")
        h.context.sdk.admin.productTag.list = async (query) => {
          h.apiCalls.push(query)
          throw nativeError
        }
        const params = new URLSearchParams({ [key]: encoded })
        const request = {
          url: `https://owned.invalid/app/settings/product-tags?${params}`,
        }
        const originalUrl = request.url
        await assert.rejects(
          h.load({ request }),
          (error) => error === nativeError
        )
        assert.equal(request.url, originalUrl)
        assert.equal(h.apiCalls.length, 1)
        const query = JSON.parse(JSON.stringify(h.apiCalls[0]))
        assert.equal(Object.hasOwn(query, key), true)
        assert.deepEqual(query, { [key]: expected })
        assert.equal(h.schema.safeParse(query).success, false)
      }
    }
  })
}

for (const entry of ["chunk-ZUBJF5QL.mjs", "app.js"]) {
  test(`${entry}: routed drawer restores only the original valid invoker after native close`, () => {
    assertNativeRouteInvokerFallback(entry, "drawer")
  })
}
