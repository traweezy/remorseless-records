export type UnknownRecord = Record<string, unknown>

type RecordArrayOptions = {
  context: string
  optional?: boolean
}

const malformedDataError = (context: string): Error =>
  new Error(`${context} returned malformed structured data.`)

export const asUnknownRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

export const readRecordArray = (
  value: unknown,
  { context, optional = false }: RecordArrayOptions
): UnknownRecord[] => {
  if ((value === null || value === undefined) && optional) {
    return []
  }
  if (!Array.isArray(value)) {
    throw malformedDataError(context)
  }

  return value.map((entry) => {
    const record = asUnknownRecord(entry)
    if (!record) {
      throw malformedDataError(context)
    }
    return record
  })
}

export const readProviderDataRecords = (
  value: unknown,
  context: string
): UnknownRecord[] => {
  const envelope = asUnknownRecord(value)
  if (!envelope || !Object.hasOwn(envelope, "data")) {
    throw malformedDataError(context)
  }
  return readRecordArray(envelope.data, { context })
}

export const readWorkflowResultRecords = (
  value: unknown,
  context: string
): UnknownRecord[] => {
  const envelope = asUnknownRecord(value)
  if (!envelope || !Object.hasOwn(envelope, "result")) {
    throw malformedDataError(context)
  }

  const result = envelope.result
  if (Array.isArray(result)) {
    return readRecordArray(result, { context })
  }
  const resultEnvelope = asUnknownRecord(result)
  if (!resultEnvelope || !Object.hasOwn(resultEnvelope, "rows")) {
    throw malformedDataError(context)
  }
  return readRecordArray(resultEnvelope.rows, { context })
}

export const readCountedRecordPage = (
  value: unknown,
  context: string
): { count: number; records: UnknownRecord[] } => {
  if (!Array.isArray(value) || value.length !== 2) {
    throw malformedDataError(context)
  }
  const records = readRecordArray(value[0], { context })
  const count = value[1]
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < records.length
  ) {
    throw malformedDataError(context)
  }
  return { count, records }
}
