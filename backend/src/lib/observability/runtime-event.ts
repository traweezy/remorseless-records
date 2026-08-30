import { isSpanContextValid, trace } from "@opentelemetry/api";

import { getBackendRuntimeIdentity } from "./runtime-identity";

export type BackendRuntimeEvent = {
  commit_sha: string;
  environment: string;
  event: string;
  message: string;
  recorded_at: string;
  request_id: string;
  service: "backend";
  span_id: string;
  trace_id: string;
};

const MACHINE_EVENT_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

export const buildBackendRuntimeEvent = (
  event: string,
  message: string,
  recordedAt = new Date(),
): BackendRuntimeEvent => {
  if (!MACHINE_EVENT_PATTERN.test(event)) {
    throw new TypeError("Runtime event name must be a bounded machine code");
  }
  if (!message || message.length > 160) {
    throw new TypeError("Runtime event message must be bounded");
  }
  if (!Number.isFinite(recordedAt.getTime())) {
    throw new TypeError("Runtime event time must be valid");
  }

  const activeSpanContext = trace.getActiveSpan()?.spanContext();
  const hasActiveTrace = Boolean(
    activeSpanContext && isSpanContextValid(activeSpanContext),
  );

  return {
    ...getBackendRuntimeIdentity(),
    event,
    message,
    recorded_at: recordedAt.toISOString(),
    request_id: "unknown",
    span_id: hasActiveTrace ? activeSpanContext!.spanId : "unknown",
    trace_id: hasActiveTrace ? activeSpanContext!.traceId : "unknown",
  };
};
