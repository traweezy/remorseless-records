import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"

import type {
  CatalogBundleComponentState,
  CatalogBundleInventoryLinkState,
  CatalogBundleMutationInput,
  CatalogBundleMutationResult,
  CatalogBundleStateSnapshot,
  JsonObject,
} from "./bundle-authoring"
import CatalogAuthoringOperation from "./models/catalog-authoring-operation"
import CatalogArtist from "./models/catalog-artist"
import CatalogBundleComponent from "./models/catalog-bundle-component"
import CatalogBundleInventoryLink from "./models/catalog-bundle-inventory-link"
import CatalogBundleProfile from "./models/catalog-bundle-profile"
import CatalogMediaAsset from "./models/catalog-media-asset"
import CatalogProductArtist from "./models/catalog-product-artist"
import CatalogProductMediaItem from "./models/catalog-product-media-item"
import CatalogProductProfile from "./models/catalog-product-profile"
import CatalogProductReference from "./models/catalog-product-reference"
import CatalogReferenceValue from "./models/catalog-reference-value"
import CatalogShelf from "./models/catalog-shelf"
import CatalogShelfProduct from "./models/catalog-shelf-product"
import CatalogVariantProfile from "./models/catalog-variant-profile"
import {
  buildOrphanCatalogMediaQueries,
  type OrphanCatalogMediaPage,
  type OrphanCatalogMediaQuery,
} from "./orphan-media-query"
import { readCatalogOrphanMediaPage } from "../../lib/catalog/persistence-contracts"
import {
  assertExactCatalogBundleSnapshot,
  readCatalogBundleComponentStates,
  readCatalogBundleInventoryLinks,
  readCatalogBundleOperationResult,
  readCatalogBundleProfileMutation,
  readCatalogBundleStateProfiles,
  readCatalogMediaAssets,
  readCatalogTransactionOperationList,
  readCatalogTransactionOperationMutation,
  readExactCatalogBundleComponents,
  readExactCatalogBundleInventoryLinks,
  type CatalogTransactionOperationExpectation,
} from "../../lib/catalog/transaction-persistence-contracts"

class CatalogModuleService extends MedusaService({
  CatalogAuthoringOperation,
  CatalogArtist,
  CatalogBundleProfile,
  CatalogBundleComponent,
  CatalogBundleInventoryLink,
  CatalogMediaAsset,
  CatalogReferenceValue,
  CatalogProductProfile,
  CatalogProductArtist,
  CatalogProductReference,
  CatalogProductMediaItem,
  CatalogVariantProfile,
  CatalogShelf,
  CatalogShelfProduct,
}) {
  @InjectTransactionManager()
  protected async runCatalogTransaction_<T>(
    task: (sharedContext: Context<EntityManager>) => Promise<T>,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<T> {
    return task(sharedContext)
  }

  @InjectManager()
  async runCatalogTransaction<T>(
    task: (sharedContext: Context<EntityManager>) => Promise<T>,
    @MedusaContext()
    sharedContext: Context<EntityManager> = {
      isolationLevel: "serializable",
    }
  ): Promise<T> {
    sharedContext.isolationLevel ??= "serializable"
    return this.runCatalogTransaction_(task, sharedContext)
  }

  @InjectManager()
  async listOrphanCatalogMediaAssets(
    input: OrphanCatalogMediaQuery,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<OrphanCatalogMediaPage> {
    const manager = sharedContext.transactionManager ?? sharedContext.manager
    if (!manager) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog media query manager is unavailable."
      )
    }
    const { countQuery, rowsQuery } = buildOrphanCatalogMediaQueries(
      manager.getKnex(),
      input
    )
    const page = readCatalogOrphanMediaPage(await countQuery, await rowsQuery)
    return {
      count: page.count,
      rows: readCatalogMediaAssets(page.rows, {
        ...(input.lifecycleStatus === undefined
          ? {}
          : { expectedLifecycleStatus: input.lifecycleStatus }),
        maximumRows: input.limit,
      }),
    }
  }

  private async snapshotBundle_(
    productId: string,
    sharedContext: Context<EntityManager>
  ): Promise<CatalogBundleStateSnapshot> {
    const profile = readCatalogBundleStateProfiles(
      await this.listCatalogBundleProfiles(
        { product_id: productId },
        { take: 2 },
        sharedContext
      ),
      productId
    ).at(0)
    if (!profile) {
      return { profile: null, components: [] }
    }

    const components = readCatalogBundleComponentStates(
      await this.listCatalogBundleComponents(
        { bundle_profile_id: profile.id },
        { order: { id: "ASC", sort_order: "ASC" }, take: 101 },
        sharedContext
      ),
      profile.id,
      100
    )
    return {
      profile,
      components,
    }
  }

  private async deleteBundleSnapshot_(
    snapshot: CatalogBundleStateSnapshot,
    sharedContext: Context<EntityManager>
  ): Promise<void> {
    if (!snapshot.profile) {
      return
    }
    if (snapshot.components.length) {
      await this.deleteCatalogBundleComponents(
        snapshot.components.map((component) => component.id),
        sharedContext
      )
    }
    await this.deleteCatalogBundleProfiles(snapshot.profile.id, sharedContext)
    assertExactCatalogBundleSnapshot(
      await this.snapshotBundle_(snapshot.profile.product_id, sharedContext),
      { components: [], profile: null }
    )
  }

  private async createBundleSnapshot_(
    snapshot: CatalogBundleStateSnapshot,
    sharedContext: Context<EntityManager>
  ): Promise<void> {
    if (!snapshot.profile) {
      return
    }
    readCatalogBundleProfileMutation(
      await this.createCatalogBundleProfiles([snapshot.profile], sharedContext),
      snapshot.profile
    )
    if (snapshot.components.length) {
      readExactCatalogBundleComponents(
        await this.createCatalogBundleComponents(
          snapshot.components,
          sharedContext
        ),
        snapshot.profile.id,
        snapshot.components
      )
    }
    assertExactCatalogBundleSnapshot(
      await this.snapshotBundle_(snapshot.profile.product_id, sharedContext),
      snapshot
    )
  }

  @InjectTransactionManager()
  protected async mutateBundle_(
    input: CatalogBundleMutationInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<CatalogBundleMutationResult> {
    const operationExpectation: CatalogTransactionOperationExpectation = {
      actorId: input.actorId,
      aggregateId: input.aggregateId,
      command: input.command,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      metadata: {},
      requestSha256: input.requestSha256,
      status: "pending",
    }
    const existingOperation = readCatalogTransactionOperationList(
      await this.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 2 },
        sharedContext
      )
    )
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === input.command &&
        existingOperation.aggregateId === input.aggregateId &&
        existingOperation.actorId === input.actorId &&
        existingOperation.expectedVersion === input.expectedVersion &&
        existingOperation.requestSha256 === input.requestSha256
      if (!sameCommand) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key was already used for a different command."
        )
      }
      if (existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The matching catalog command did not complete. Refresh and retry with a new idempotency key."
        )
      }
      const result = readCatalogBundleOperationResult(
        existingOperation.result,
        input.aggregateId
      )
      return {
        operationId: existingOperation.id,
        previous: { profile: null, components: [] },
        profileId: result.profileId,
        replayed: true,
        result,
        version: result.version,
      }
    }

    const previous = await this.snapshotBundle_(
      input.aggregateId,
      sharedContext
    )
    const currentVersion = previous.profile?.version ?? 0
    if (currentVersion !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The bundle changed after it was loaded. Refresh before saving."
      )
    }

    const operation = readCatalogTransactionOperationMutation(
      await this.createCatalogAuthoringOperations(
        [
          {
            idempotency_key: input.idempotencyKey,
            command: input.command,
            aggregate_id: input.aggregateId,
            actor_id: input.actorId,
            request_sha256: input.requestSha256,
            expected_version: input.expectedVersion,
            status: "pending",
            result: {},
            metadata: {},
          },
        ],
        sharedContext
      ),
      operationExpectation
    )

    if (!input.profile) {
      await this.deleteBundleSnapshot_(previous, sharedContext)
      return {
        operationId: operation.id,
        previous,
        profileId: null,
        replayed: false,
        result: {},
        version: currentVersion + 1,
      }
    }

    const profileId = previous.profile?.id
    const version = currentVersion + 1
    if (previous.components.length) {
      await this.deleteCatalogBundleComponents(
        previous.components.map((component) => component.id),
        sharedContext
      )
      readExactCatalogBundleComponents(
        await this.listCatalogBundleComponents(
          { bundle_profile_id: profileId! },
          { take: 1 },
          sharedContext
        ),
        profileId!,
        []
      )
    }
    const profilePayload = {
      ...input.profile,
      version,
    }
    const profile = profileId
      ? readCatalogBundleProfileMutation(
          await this.updateCatalogBundleProfiles(
            [
              {
                id: profileId,
                ...profilePayload,
              },
            ],
            sharedContext
          ),
          { id: profileId, ...profilePayload }
        )
      : readCatalogBundleProfileMutation(
          await this.createCatalogBundleProfiles(
            [
              {
                ...profilePayload,
              },
            ],
            sharedContext
          ),
          profilePayload
        )
    const componentPayloads = input.components.map((component) => ({
      ...component,
      bundle_profile_id: profile.id,
    }))
    let components: CatalogBundleComponentState[] = []
    if (input.components.length) {
      components = readExactCatalogBundleComponents(
        await this.createCatalogBundleComponents(
          componentPayloads,
          sharedContext
        ),
        profile.id,
        componentPayloads
      )
    }
    assertExactCatalogBundleSnapshot(
      await this.snapshotBundle_(input.aggregateId, sharedContext),
      { components, profile }
    )

    return {
      operationId: operation.id,
      previous,
      profileId: profile.id,
      replayed: false,
      result: {},
      version,
    }
  }

  @InjectManager()
  async mutateBundle(
    input: CatalogBundleMutationInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<CatalogBundleMutationResult> {
    return this.mutateBundle_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async compensateBundleMutation_(
    input: {
      aggregateId: string
      operationId: string
      previous: CatalogBundleStateSnapshot
    },
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<void> {
    const operation = readCatalogTransactionOperationList(
      await this.listCatalogAuthoringOperations(
        { id: input.operationId },
        { take: 2 },
        sharedContext
      )
    )
    if (
      !operation ||
      operation.id !== input.operationId ||
      operation.status !== "pending"
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The bundle compensation operation could not be verified."
      )
    }
    const current = await this.snapshotBundle_(input.aggregateId, sharedContext)
    await this.deleteBundleSnapshot_(current, sharedContext)
    await this.createBundleSnapshot_(input.previous, sharedContext)
    readCatalogTransactionOperationMutation(
      await this.updateCatalogAuthoringOperations(
        [
          {
            id: input.operationId,
            status: "compensated",
            completed_at: new Date(),
            error_code: "workflow_compensated",
            error_detail:
              "A later workflow step failed; the previous bundle state was restored.",
          },
        ],
        sharedContext
      ),
      { ...operation, id: input.operationId, status: "compensated" }
    )
  }

  @InjectManager()
  async compensateBundleMutation(
    input: {
      aggregateId: string
      operationId: string
      previous: CatalogBundleStateSnapshot
    },
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<void> {
    return this.compensateBundleMutation_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async replaceBundleInventoryLinks_(
    bundleProfileId: string,
    links: CatalogBundleInventoryLinkState[],
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<void> {
    const existing = readCatalogBundleInventoryLinks(
      await this.listCatalogBundleInventoryLinks(
        { bundle_profile_id: bundleProfileId },
        { take: 101 },
        sharedContext
      ),
      bundleProfileId,
      100
    )
    if (existing.length) {
      await this.deleteCatalogBundleInventoryLinks(
        existing.map((link) => link.id),
        sharedContext
      )
    }
    if (links.length) {
      readExactCatalogBundleInventoryLinks(
        await this.createCatalogBundleInventoryLinks(
          links.map(({ id: _id, ...link }) => link),
          sharedContext
        ),
        bundleProfileId,
        links
      )
    }
    readExactCatalogBundleInventoryLinks(
      await this.listCatalogBundleInventoryLinks(
        { bundle_profile_id: bundleProfileId },
        { take: 101 },
        sharedContext
      ),
      bundleProfileId,
      links
    )
  }

  @InjectManager()
  async replaceBundleInventoryLinks(
    bundleProfileId: string,
    links: CatalogBundleInventoryLinkState[],
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<void> {
    return this.replaceBundleInventoryLinks_(
      bundleProfileId,
      links,
      sharedContext
    )
  }

  @InjectTransactionManager()
  protected async completeCatalogAuthoringOperation_(
    operationId: string,
    result: JsonObject,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<unknown> {
    const operation = readCatalogTransactionOperationList(
      await this.listCatalogAuthoringOperations(
        { id: operationId },
        { take: 2 },
        sharedContext
      )
    )
    if (
      !operation ||
      operation.id !== operationId ||
      operation.status !== "pending"
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog operation completion could not be verified."
      )
    }
    const updated = await this.updateCatalogAuthoringOperations(
      [
        {
          id: operationId,
          status: "succeeded",
          result,
          error_code: null,
          error_detail: null,
          completed_at: new Date(),
        },
      ],
      sharedContext
    )
    readCatalogTransactionOperationMutation(updated, {
      ...operation,
      id: operationId,
      result,
      status: "succeeded",
    })
    return updated
  }

  @InjectManager()
  async completeCatalogAuthoringOperation(
    operationId: string,
    result: JsonObject,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<unknown> {
    return this.completeCatalogAuthoringOperation_(
      operationId,
      result,
      sharedContext
    )
  }
}

export default CatalogModuleService
