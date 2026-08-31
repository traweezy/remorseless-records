import type {
  CreateNotificationDTO,
  INotificationModuleService,
} from "@medusajs/framework/types"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import {
  readFiniteNumber,
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
  readRequiredRecord,
  type UnknownRecord,
} from "../provider-boundary/records"

const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const SAFE_TOKEN = /^[\x21-\x7e]+$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const NOTIFICATION_ID = /^noti_[A-Za-z0-9]+$/
const MAX_EMAIL_LENGTH = 254
const MAX_ORDER_ITEMS = 250

const malformed = (context: string): Error =>
  new Error(`${context} is malformed.`)

const exactId = (value: unknown, prefix: string): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length <= 255 &&
    normalized.startsWith(`${prefix}_`) &&
    SAFE_ID.test(normalized)
    ? normalized
    : null
}

const requiredText = (value: unknown, maximumLength: number): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized &&
    normalized.length <= maximumLength &&
    !CONTROL_CHARACTERS.test(normalized)
    ? normalized
    : null
}

const optionalText = (value: unknown, maximumLength: number): string | null => {
  if (value === null || value === undefined || value === "") {
    return null
  }
  return requiredText(value, maximumLength)
}

export const readNotificationEmail = (value: unknown): string | null => {
  const email = requiredText(value, MAX_EMAIL_LENGTH)
  if (!email || !EMAIL.test(email)) {
    return null
  }
  const separator = email.lastIndexOf("@")
  return separator > 0 && separator <= 64 ? email : null
}

export const readNotificationText = (
  value: unknown,
  maximumLength: number
): string | null => requiredText(value, maximumLength)

export const readNotificationEntityId = (
  value: unknown,
  prefix: string
): string | null => exactId(value, prefix)

export type InviteNotificationProjection = {
  email: string
  id: string
  token: string
}

export const readInviteNotificationProjection = (
  value: unknown,
  expectedId: string,
  now = new Date()
): InviteNotificationProjection => {
  const record = readRequiredRecord(value, "Invite notification projection")
  const id = exactId(record.id, "invite")
  const email = readNotificationEmail(record.email)
  const token = requiredText(record.token, 4_096)
  const expiresAt = readIsoTimestamp(record.expires_at)
  const expected = exactId(expectedId, "invite")

  if (
    !id ||
    id !== expected ||
    !email ||
    !token ||
    !SAFE_TOKEN.test(token) ||
    record.accepted !== false ||
    !expiresAt ||
    new Date(expiresAt).getTime() <= now.getTime() ||
    (record.deleted_at !== null && record.deleted_at !== undefined)
  ) {
    throw malformed("Invite notification projection")
  }

  return { email, id, token }
}

export const inviteNotificationIdempotencyKey = (
  invite: InviteNotificationProjection
): string => {
  const tokenDigest = createHash("sha256")
    .update(invite.token, "utf8")
    .digest("hex")
    .slice(0, 32)
  return `invite-user:${invite.id}:${tokenDigest}`
}

export const buildInviteNotificationLink = (
  backendUrl: string,
  token: string
): string => {
  const normalized = backendUrl.trim()
  let origin: URL
  try {
    origin = new URL(
      /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(normalized)
        ? normalized
        : `https://${normalized}`
    )
  } catch {
    throw malformed("Invite notification backend URL")
  }

  const developmentHost =
    origin.hostname === "localhost" || origin.hostname === "127.0.0.1"
  if (
    (origin.protocol !== "https:" &&
      !(developmentHost && origin.protocol === "http:")) ||
    origin.username ||
    origin.password
  ) {
    throw malformed("Invite notification backend URL")
  }

  const link = new URL("/app/invite", origin.origin)
  link.searchParams.set("token", token)
  return link.toString()
}

export type OrderNotificationItem = {
  id: string
  product_title: string
  quantity: number
  title: string
  unit_price: number
}

export type OrderNotificationAddress = {
  address_1: string
  city: string
  country_code: string
  first_name: string
  last_name: string | null
  postal_code: string
  province: string | null
}

export type OrderNotificationProjection = {
  customerId: string | null
  email: string
  order: {
    created_at: string
    currency_code: string
    display_id: number
    id: string
    items: OrderNotificationItem[]
    summary: { raw_current_order_total: number }
  }
  shippingAddress: OrderNotificationAddress
}

const readOrderAddress = (value: unknown): OrderNotificationAddress => {
  const address = readRequiredRecord(value, "Order notification address")
  const firstName = requiredText(address.first_name, 120)
  const lastName = optionalText(address.last_name, 120)
  const address1 = requiredText(address.address_1, 255)
  const city = requiredText(address.city, 120)
  const province = optionalText(address.province, 120)
  const postalCode = requiredText(address.postal_code, 32)
  const countryCode = requiredText(address.country_code, 2)?.toUpperCase()

  if (
    !firstName ||
    !address1 ||
    !city ||
    !postalCode ||
    !countryCode ||
    !/^[A-Z]{2}$/.test(countryCode) ||
    (address.last_name !== null &&
      address.last_name !== undefined &&
      address.last_name !== "" &&
      !lastName) ||
    (address.province !== null &&
      address.province !== undefined &&
      address.province !== "" &&
      !province)
  ) {
    throw malformed("Order notification address")
  }

  return {
    address_1: address1,
    city,
    country_code: countryCode,
    first_name: firstName,
    last_name: lastName,
    postal_code: postalCode,
    province,
  }
}

const readOrderItems = (value: unknown): OrderNotificationItem[] => {
  const records = readRecordArray(value, {
    context: "Order notification items",
  })
  if (!records.length || records.length > MAX_ORDER_ITEMS) {
    throw malformed("Order notification items")
  }

  const items = records.map((record) => {
    const id = exactId(record.id, "ordli")
    const title = requiredText(record.title, 255)
    const productTitle = requiredText(record.product_title, 255)
    const quantity = readNonNegativeSafeInteger(record.quantity)
    const unitPrice = readFiniteNumber(record.unit_price)
    if (
      !id ||
      !title ||
      !productTitle ||
      quantity === null ||
      quantity < 1 ||
      unitPrice === null ||
      unitPrice < 0
    ) {
      throw malformed("Order notification item")
    }
    return {
      id,
      product_title: productTitle,
      quantity,
      title,
      unit_price: unitPrice,
    }
  })

  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw malformed("Order notification items")
  }
  return items
}

export const readOrderNotificationProjection = (
  value: unknown,
  expectedId: string
): OrderNotificationProjection | null => {
  const record = readRequiredRecord(value, "Order notification projection")
  const id = exactId(record.id, "order")
  const expected = exactId(expectedId, "order")
  if (!id || id !== expected) {
    throw malformed("Order notification projection")
  }
  if (
    record.email === null ||
    record.email === undefined ||
    record.shipping_address === null ||
    record.shipping_address === undefined
  ) {
    return null
  }

  const email = readNotificationEmail(record.email)
  const customerId =
    record.customer_id === null || record.customer_id === undefined
      ? null
      : exactId(record.customer_id, "cus")
  const displayId = readNonNegativeSafeInteger(record.display_id)
  const createdAt = readIsoTimestamp(record.created_at)
  const currencyCode = requiredText(record.currency_code, 3)?.toLowerCase()
  const summary = asUnknownRecord(record.summary)
  const total = readFiniteNumber(summary?.raw_current_order_total)

  if (
    !email ||
    (record.customer_id !== null &&
      record.customer_id !== undefined &&
      !customerId) ||
    displayId === null ||
    displayId < 1 ||
    !createdAt ||
    !currencyCode ||
    !/^[a-z]{3}$/.test(currencyCode) ||
    total === null ||
    total < 0
  ) {
    throw malformed("Order notification projection")
  }

  return {
    customerId,
    email,
    order: {
      created_at: createdAt,
      currency_code: currencyCode,
      display_id: displayId,
      id,
      items: readOrderItems(record.items),
      summary: { raw_current_order_total: total },
    },
    shippingAddress: readOrderAddress(record.shipping_address),
  }
}

type NotificationServiceReadback = {
  createNotifications: (payloads: CreateNotificationDTO[]) => Promise<unknown>
  listNotifications: (
    filters: Record<string, unknown>,
    config: Record<string, unknown>
  ) => Promise<unknown>
  retrieveNotification: (id: string) => Promise<unknown>
  updateNotifications: (input: {
    data: Record<string, unknown>
    id: string
  }) => Promise<unknown>
}

export type NotificationDataRetention = Readonly<
  Record<string, Record<string, unknown>>
>

const nullableEqual = (actual: unknown, expected: unknown): boolean =>
  (actual ?? null) === (expected ?? null)

const persistedNotificationMatches = (
  value: unknown,
  expected: CreateNotificationDTO,
  expectedData: unknown = expected.data ?? null
): boolean => {
  const record = asUnknownRecord(value)
  const providerData = asUnknownRecord(record?.provider_data)
  const idempotencyKey = expected.idempotency_key
  return Boolean(
    record &&
      typeof record.id === "string" &&
      NOTIFICATION_ID.test(record.id) &&
      record.idempotency_key === idempotencyKey &&
      record.to === expected.to &&
      record.channel === expected.channel &&
      record.template === expected.template &&
      nullableEqual(record.trigger_type, expected.trigger_type) &&
      nullableEqual(record.resource_id, expected.resource_id) &&
      nullableEqual(record.resource_type, expected.resource_type) &&
      nullableEqual(record.receiver_id, expected.receiver_id) &&
      record.status === "success" &&
      typeof record.external_id === "string" &&
      record.external_id.length <= 255 &&
      SAFE_ID.test(record.external_id) &&
      typeof record.provider_id === "string" &&
      record.provider_id.length <= 255 &&
      SAFE_ID.test(record.provider_id) &&
      readIsoTimestamp(record.created_at) &&
      providerData &&
      providerData.idempotency_key === idempotencyKey &&
      Object.keys(providerData).length === 1 &&
      isDeepStrictEqual(record.data ?? null, expectedData)
  )
}

const validatePayloads = (payloads: CreateNotificationDTO[]): string[] => {
  if (!payloads.length || payloads.length > 50) {
    throw malformed("Notification delivery batch")
  }
  const keys = payloads.map((payload) => {
    const key = requiredText(payload.idempotency_key, 256)
    const providerData = asUnknownRecord(payload.provider_data)
    if (
      !key ||
      !providerData ||
      providerData.idempotency_key !== key ||
      Object.keys(providerData).length !== 1 ||
      payload.channel !== "email" ||
      !readNotificationEmail(payload.to) ||
      !requiredText(payload.template, 255)
    ) {
      throw malformed("Notification delivery payload")
    }
    return key
  })
  if (new Set(keys).size !== keys.length) {
    throw malformed("Notification delivery batch")
  }
  return keys
}

const readRecordResult = (value: unknown, context: string): UnknownRecord[] =>
  readRecordArray(value, { context })

export const createAndVerifyNotifications = async (
  service: INotificationModuleService,
  payloads: CreateNotificationDTO[],
  retainedData: NotificationDataRetention = {}
): Promise<void> => {
  const keys = validatePayloads(payloads)
  if (
    Object.keys(retainedData).some(
      (key) => !keys.includes(key) || !asUnknownRecord(retainedData[key])
    )
  ) {
    throw malformed("Notification data-retention policy")
  }
  const readback = service as unknown as NotificationServiceReadback
  const acknowledgement = readRecordResult(
    await readback.createNotifications(payloads),
    "Notification delivery acknowledgement"
  )
  if (
    acknowledgement.length > payloads.length ||
    acknowledgement.some(
      (record) =>
        !payloads.some((payload) =>
          persistedNotificationMatches(record, payload)
        )
    )
  ) {
    throw malformed("Notification delivery acknowledgement")
  }

  const persisted = readRecordResult(
    await readback.listNotifications(
      { idempotency_key: keys },
      { take: payloads.length + 1 }
    ),
    "Notification delivery readback"
  )
  if (
    persisted.length !== payloads.length ||
    new Set(
      persisted.map((record) =>
        typeof record.id === "string" ? record.id : null
      )
    ).size !== persisted.length ||
    payloads.some(
      (payload) =>
        persisted.filter(
          (record) =>
            persistedNotificationMatches(record, payload) ||
            (payload.idempotency_key !== null &&
              payload.idempotency_key !== undefined &&
              retainedData[payload.idempotency_key] !== undefined &&
              persistedNotificationMatches(
                record,
                payload,
                retainedData[payload.idempotency_key]
              ))
        ).length !== 1
    )
  ) {
    throw malformed("Notification delivery readback")
  }

  for (const payload of payloads) {
    const key = payload.idempotency_key
    const retained = key ? retainedData[key] : undefined
    if (!retained) {
      continue
    }
    const record = persisted.find(
      (candidate) =>
        persistedNotificationMatches(candidate, payload) ||
        persistedNotificationMatches(candidate, payload, retained)
    )
    if (!record) {
      throw malformed("Notification data-retention readback")
    }
    if (persistedNotificationMatches(record, payload, retained)) {
      continue
    }
    const acknowledgement = await readback.updateNotifications({
      data: retained,
      id: record.id as string,
    })
    if (!persistedNotificationMatches(acknowledgement, payload, retained)) {
      throw malformed("Notification data-retention acknowledgement")
    }
    const finalRecord = await readback.retrieveNotification(record.id as string)
    if (!persistedNotificationMatches(finalRecord, payload, retained)) {
      throw malformed("Notification data-retention readback")
    }
  }
}
