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
const uiRoot = join(dirname(backendRequire.resolve("@medusajs/ui")), "../..")

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

const nativeMenuHarness = (distribution, component, instance) => {
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
  test(`${distribution}: native sortable-header target preserves sorting and plain headers`, () => {
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
    const core = {
      DndContext: "drag",
      closestCenter: "center",
      KeyboardSensor: "keyboard",
      PointerSensor: "pointer",
      useSensor: () => null,
      useSensors: () => [],
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
      const rendered = nativeTable({})
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

for (const entry of ["chunk-H7AAHR2V.mjs", "app.js"]) {
  test(`${entry}: routed modal fallback waits for native focus and rejects stale invokers`, () => {
    const expression = nativeArrow(entry, entry === "app.js" ? "Root2" : "Root")
    class NativeHTMLElement {
      isConnected = true
      disabled = false
      hidden = false
      rects = [{}]
      style = { visibility: "visible", display: "block" }
      focused = 0
      getClientRects() {
        return this.rects
      }
      matches(selector) {
        assert.equal(selector, ":disabled")
        return this.disabled
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
        FocusModal: "focus-modal",
        Content: "content",
        RouteModalProvider: "route-provider",
        StackedModalProvider: "stacked-provider",
        useNavigate2:
          () =>
          (...args) =>
            navigation.push(args),
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
          context[token] = { FocusModal: "focus-modal" }
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
    const unfocused = render({})
    unfocused.document.activeElement = unfocused.body
    unfocused.callback({ defaultPrevented: false })
    unfocused.queued.shift()()
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
