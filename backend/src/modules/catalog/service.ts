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
  CatalogBundleProfileState,
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

const asJsonObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {}

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
    @MedusaContext() sharedContext: Context<EntityManager> = {
      isolationLevel: "serializable",
    }
  ): Promise<T> {
    sharedContext.isolationLevel ??= "serializable"
    return this.runCatalogTransaction_(task, sharedContext)
  }

  private async snapshotBundle_(
    productId: string,
    sharedContext: Context<EntityManager>
  ): Promise<CatalogBundleStateSnapshot> {
    const profile = (
      await this.listCatalogBundleProfiles(
        { product_id: productId },
        { take: 1 },
        sharedContext
      )
    )[0]
    if (!profile) {
      return { profile: null, components: [] }
    }

    const components = await this.listCatalogBundleComponents(
      { bundle_profile_id: profile.id },
      { order: { sort_order: "ASC" } },
      sharedContext
    )
    return {
      profile: {
        id: profile.id,
        product_id: profile.product_id,
        product_profile_id: profile.product_profile_id ?? null,
        bundle_type: profile.bundle_type,
        inventory_mode: profile.inventory_mode,
        fulfillment_mode: profile.fulfillment_mode,
        display_title: profile.display_title ?? null,
        description_html: profile.description_html ?? null,
        is_active: profile.is_active,
        version: profile.version,
        metadata: asJsonObject(profile.metadata),
      },
      components: components.map(
        (component): CatalogBundleComponentState => ({
          id: component.id,
          bundle_profile_id: component.bundle_profile_id,
          component_product_id: component.component_product_id,
          component_variant_id: component.component_variant_id ?? null,
          component_inventory_item_id:
            component.component_inventory_item_id ?? null,
          title: component.title ?? null,
          variant_title: component.variant_title ?? null,
          sku: component.sku ?? null,
          quantity: component.quantity,
          sort_order: component.sort_order,
          is_required: component.is_required,
          metadata: asJsonObject(component.metadata),
        })
      ),
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
  }

  private async createBundleSnapshot_(
    snapshot: CatalogBundleStateSnapshot,
    sharedContext: Context<EntityManager>
  ): Promise<void> {
    if (!snapshot.profile) {
      return
    }
    await this.createCatalogBundleProfiles([snapshot.profile], sharedContext)
    if (snapshot.components.length) {
      await this.createCatalogBundleComponents(
        snapshot.components,
        sharedContext
      )
    }
  }

  @InjectTransactionManager()
  protected async mutateBundle_(
    input: CatalogBundleMutationInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<CatalogBundleMutationResult> {
    const existingOperation = (
      await this.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 1 },
        sharedContext
      )
    )[0]
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === input.command &&
        existingOperation.aggregate_id === input.aggregateId &&
        existingOperation.actor_id === input.actorId &&
        existingOperation.expected_version === input.expectedVersion &&
        existingOperation.request_sha256 === input.requestSha256
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
      const result = asJsonObject(existingOperation.result)
      return {
        operationId: existingOperation.id,
        previous: { profile: null, components: [] },
        profileId:
          typeof result.profileId === "string" ? result.profileId : null,
        replayed: true,
        result,
        version:
          typeof result.version === "number"
            ? result.version
            : input.expectedVersion,
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

    const [operation] = await this.createCatalogAuthoringOperations(
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
    )
    if (!operation) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog command audit record was not created."
      )
    }

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
    }
    const [profile] = profileId
      ? await this.updateCatalogBundleProfiles(
          [
            {
              id: profileId,
              ...input.profile,
              version,
            },
          ],
          sharedContext
        )
      : await this.createCatalogBundleProfiles(
          [
            {
              ...input.profile,
              version,
            },
          ],
          sharedContext
        )
    if (!profile) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog bundle was not persisted."
      )
    }
    if (input.components.length) {
      await this.createCatalogBundleComponents(
        input.components.map((component) => ({
          ...component,
          bundle_profile_id: profile.id,
        })),
        sharedContext
      )
    }

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
    const current = await this.snapshotBundle_(
      input.aggregateId,
      sharedContext
    )
    await this.deleteBundleSnapshot_(current, sharedContext)
    await this.createBundleSnapshot_(input.previous, sharedContext)
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
    const existing = await this.listCatalogBundleInventoryLinks(
      { bundle_profile_id: bundleProfileId },
      {},
      sharedContext
    )
    if (existing.length) {
      await this.deleteCatalogBundleInventoryLinks(
        existing.map((link) => link.id),
        sharedContext
      )
    }
    if (links.length) {
      await this.createCatalogBundleInventoryLinks(
        links.map(({ id: _id, ...link }) => link),
        sharedContext
      )
    }
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
  ): Promise<void> {
    await this.updateCatalogAuthoringOperations(
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
  }

  @InjectManager()
  async completeCatalogAuthoringOperation(
    operationId: string,
    result: JsonObject,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<void> {
    return this.completeCatalogAuthoringOperation_(
      operationId,
      result,
      sharedContext
    )
  }
}

export default CatalogModuleService
