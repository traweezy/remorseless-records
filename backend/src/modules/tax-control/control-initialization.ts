import { MedusaError } from "@medusajs/framework/utils"

type EnsureTaxProviderControlInput<T> = {
  create: () => Promise<T | null | undefined>
  retrieve: () => Promise<T>
}

const isMedusaErrorType = (error: unknown, type: string): boolean =>
  MedusaError.isMedusaError(error) && error.type === type

export const ensureTaxProviderControlSingleton = async <T>({
  create,
  retrieve,
}: EnsureTaxProviderControlInput<T>): Promise<T> => {
  try {
    return await retrieve()
  } catch (error) {
    if (!isMedusaErrorType(error, MedusaError.Types.NOT_FOUND)) {
      throw error
    }
  }

  try {
    const created = await create()
    if (!created) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Tax provider control could not be initialized."
      )
    }
    return created
  } catch (error) {
    if (!isMedusaErrorType(error, MedusaError.Types.DUPLICATE_ERROR)) {
      throw error
    }
    return retrieve()
  }
}
