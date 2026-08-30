import type { TaxCollectionMode, TaxProviderName } from "./constants";

type TaxControlTransitionRequestIdentity = {
  acknowledgementVersion: string;
  actorId: string;
  expectedGeneration: number;
  reason: string;
  targetCollectionMode: TaxCollectionMode;
  targetProvider: TaxProviderName;
};

type TaxControlTransitionAuditIdentity = {
  acknowledgement_version: string;
  actor_id: string;
  from_generation: number;
  reason: string;
  to_collection_mode: TaxCollectionMode;
  to_generation: number;
  to_provider: TaxProviderName;
};

export const matchesTaxControlTransitionReplay = (
  audit: TaxControlTransitionAuditIdentity,
  input: TaxControlTransitionRequestIdentity,
): boolean =>
  audit.acknowledgement_version === input.acknowledgementVersion &&
  audit.actor_id === input.actorId &&
  Number(audit.from_generation) === input.expectedGeneration &&
  audit.reason === input.reason &&
  audit.to_collection_mode === input.targetCollectionMode &&
  Number(audit.to_generation) === input.expectedGeneration + 1 &&
  audit.to_provider === input.targetProvider;
