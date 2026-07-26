import type { TaxProviderName } from "./constants";

type ProviderSwitchRequestIdentity = {
  actorId: string;
  expectedGeneration: number;
  reason: string;
  targetProvider: TaxProviderName;
};

type ProviderSwitchAuditIdentity = {
  actor_id: string;
  from_generation: number;
  reason: string;
  to_generation: number;
  to_provider: TaxProviderName;
};

export const matchesProviderSwitchReplay = (
  audit: ProviderSwitchAuditIdentity,
  input: ProviderSwitchRequestIdentity,
): boolean =>
  audit.actor_id === input.actorId &&
  Number(audit.from_generation) === input.expectedGeneration &&
  audit.reason === input.reason &&
  Number(audit.to_generation) === input.expectedGeneration + 1 &&
  audit.to_provider === input.targetProvider;
