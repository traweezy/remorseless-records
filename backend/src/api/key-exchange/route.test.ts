import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { GET } from "./route"

type ResponseState = {
  body: unknown
  headers: Record<string, string>
  status: number
}

const responseFixture = (): {
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = { body: null, headers: {}, status: 200 }
  const response = { locals: {} } as MedusaResponse
  response.setHeader = jest.fn((name: string, value: string) => {
    state.headers[name.toLowerCase()] = value
    return response
  }) as MedusaResponse["setHeader"]
  response.type = jest.fn((value: string) => {
    state.headers["content-type"] = value
    return response
  }) as MedusaResponse["type"]
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const requestFixture = (listApiKeys: jest.Mock): MedusaRequest =>
  ({
    headers: {
      "x-request-id": "key-exchange-contract-test",
      traceparent:
        "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    },
    path: "/key-exchange",
    scope: {
      resolve: jest.fn((key: string) => {
        if (key === Modules.API_KEY) {
          return { listApiKeys }
        }
        throw new Error(`Unexpected dependency: ${key}`)
      }),
    },
  }) as unknown as MedusaRequest

describe("GET /key-exchange", () => {
  it("returns the browser-safe publishable key without caching it", async () => {
    const req = requestFixture(
      jest.fn(async () => [
        { title: "Other", token: "pk_other" },
        { title: "Webshop", token: "pk_webshop" },
      ]),
    )
    const { res, state } = responseFixture()

    await GET(req, res)

    expect(state).toEqual({
      body: { publishableApiKey: "pk_webshop" },
      headers: { "cache-control": "no-store" },
      status: 200,
    })
  })

  it.each([
    ["missing key", jest.fn(async () => [])],
    [
      "module failure",
      jest.fn(async () => {
        throw new Error("database password is secret")
      }),
    ],
  ])("returns a correlated safe problem for %s", async (_name, listApiKeys) => {
    const req = requestFixture(listApiKeys)
    const { res, state } = responseFixture()

    await GET(req, res)

    expect(state.status).toBe(503)
    expect(state.headers).toEqual({
      "cache-control": "no-store",
      "content-type": "application/problem+json",
      "x-request-id": "key-exchange-contract-test",
      traceparent: expect.stringMatching(
        /^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-01$/u,
      ),
    })
    expect(state.body).toEqual({
      type:
        "https://remorselessrecords.com/problems/publishable_key_unavailable",
      title: "Publishable key is unavailable",
      status: 503,
      detail: "The Store API publishable key is unavailable. Try again shortly.",
      code: "publishable_key_unavailable",
      instance: "/key-exchange",
      request_id: "key-exchange-contract-test",
      trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })
    expect(JSON.stringify(state.body)).not.toContain("password")
  })
})
