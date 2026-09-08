import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { compileFunction } from "node:vm"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const backendRequire = createRequire(
  join(repositoryRoot, "backend", "package.json")
)
const frameworkRequire = createRequire(
  join(
    realpathSync(
      join(repositoryRoot, "backend/node_modules/@medusajs/framework")
    ),
    "package.json"
  )
)
// Use Medusa's installed metadata runtime in this isolated test process.
frameworkRequire("reflect-metadata")

const jestConfig = backendRequire("./jest.config.cjs")
const [transformerName, transformOptions] =
  jestConfig.transform["^.+\\.[cm]?[tj]sx?$"]
assert.equal(transformerName, "@swc/jest")
const { createTransformer } = backendRequire(transformerName)
const transformerRequire = createRequire(
  backendRequire.resolve(transformerName)
)
const swc = transformerRequire("@swc/core")
const react = backendRequire("react")

const compile = (source, filename) => {
  // @swc/jest mutates nested options; each fixture gets an independent copy of
  // the real Backend configuration, including legacy decorators and React JSX.
  const transformer = createTransformer(structuredClone(transformOptions))
  return transformer.process(
    source,
    join(repositoryRoot, "backend", filename),
    {
      instrument: false,
      supportsStaticESM: false,
    }
  ).code
}

const execute = (source, filename) => {
  const code = compile(source, filename)
  const module = { exports: {} }
  // Only the trusted fixture literals below are executed. Backend resolution
  // keeps the JSX runtime on React 18 instead of the Storefront's React 19.
  compileFunction(code, ["require", "module", "exports"], { filename })(
    backendRequire,
    module,
    module.exports
  )
  return module.exports
}

test("Backend SWC executes legacy decorators with real reflection metadata", (context) => {
  assert.equal(swc, backendRequire("@swc/core"))
  context.diagnostic(`SWC ${swc.version}; Backend React ${react.version}`)
  const { Example, Service, events, decoratedClasses } = execute(
    `
      export const events: string[] = []
      export const decoratedClasses: Function[] = []
      const recordClass = (target: Function) => { decoratedClasses.push(target) }
      const recordProperty = (_target: object, key: string) => {
        events.push("property:" + key)
      }
      const recordMethod = (_target: object, key: string, descriptor: PropertyDescriptor) => {
        if (typeof descriptor.value !== "function") throw new Error("method missing")
        events.push("method:" + key)
      }
      const recordParameter = (_target: object, key: string | undefined, index: number) => {
        events.push("parameter:" + (key ?? "constructor") + ":" + index)
      }
      export class Service { name = "service" }
      @recordClass
      export class Example {
        @recordProperty
        count: number = 7
        constructor(@recordParameter public service: Service) {}
        @recordMethod
        format(@recordParameter value: number): string {
          return this.service.name + ":" + (this.count + value)
        }
      }
    `,
    "swc-metadata-fixture.ts"
  )

  assert.deepEqual(decoratedClasses, [Example])
  assert.deepEqual(events.toSorted(), [
    "method:format",
    "parameter:constructor:0",
    "parameter:format:0",
    "property:count",
  ])
  assert.equal(new Example(new Service()).format(5), "service:12")
  assert.equal(
    Reflect.getMetadata("design:type", Example.prototype, "count"),
    Number
  )
  assert.deepEqual(Reflect.getMetadata("design:paramtypes", Example), [Service])
  assert.equal(
    Reflect.getMetadata("design:type", Example.prototype, "format"),
    Function
  )
  assert.deepEqual(
    Reflect.getMetadata("design:paramtypes", Example.prototype, "format"),
    [Number]
  )
  assert.equal(
    Reflect.getMetadata("design:returntype", Example.prototype, "format"),
    String
  )
})

test("legacy decorators retain outer class identity around an undecorated nested class", () => {
  // This is a legacy-mode compatibility guard, not a reproduction of SWC's
  // separate decoratorVersion 2022-03 nested-class fix (upstream #12076).
  const { Outer, classes, properties } = execute(
    `
      export const classes: Function[] = []
      export const properties: [object, string][] = []
      const recordClass = (target: Function) => { classes.push(target) }
      const recordProperty = (target: object, key: string) => {
        properties.push([target, key])
      }
      @recordClass
      export class Outer {
        static Nested = class Inner { value: number = 11 }
        @recordProperty
        value: number = 23
      }
    `,
    "swc-nested-class-fixture.ts"
  )

  assert.deepEqual(classes, [Outer])
  assert.deepEqual(properties, [[Outer.prototype, "value"]])
  assert.notEqual(Outer.Nested, Outer)
  const inner = new Outer.Nested()
  assert.equal(inner.constructor, Outer.Nested)
  assert.ok(inner instanceof Outer.Nested)
  assert.ok(!(inner instanceof Outer))
  assert.equal(inner.value, 11)
  assert.equal(new Outer().value, 23)
  assert.equal(
    Reflect.getMetadata("design:type", Outer.prototype, "value"),
    Number
  )
  assert.equal(
    Reflect.getMetadata("design:type", Outer.Nested.prototype, "value"),
    undefined
  )
})

test("Backend SWC emits executable automatic TSX using Backend React", () => {
  assert.match(react.version, /^18\./u)
  const { element } = execute(
    `
      const count: number = 3
      export const element = <section data-count={count}><span>Hello</span>{2}</section>
    `,
    "swc-react-fixture.tsx"
  )

  assert.ok(react.isValidElement(element))
  assert.equal(element.type, "section")
  assert.equal(element.props["data-count"], 3)
  const [child, count] = element.props.children
  assert.ok(react.isValidElement(child))
  assert.equal(child.type, "span")
  assert.equal(child.props.children, "Hello")
  assert.equal(count, 2)
})

test("Backend SWC rejects malformed TypeScript instead of emitting executable output", () => {
  assert.throws(
    () => compile("export const broken: = 3", "swc-invalid-fixture.ts"),
    (error) => error instanceof Error && error.message.length > 0
  )
})
