// The plugin invokes every product transformer with Promise.all. One product
// already fans out across six catalog reads plus inventory. Serialize products
// across overlapping index jobs so indexing cannot queue thousands of DB reads.
// A failed transform must release the slot and preserve the original rejection.
let tail: Promise<void> = Promise.resolve()
let waiting = 0
const MAX_WAITING = 10_000

export const withSearchTransformBudget = async <T>(
  task: () => Promise<T>
): Promise<T> => {
  if (waiting >= MAX_WAITING) {
    throw new Error("Search transform capacity exceeded")
  }
  waiting += 1
  const previous = tail
  let release!: () => void
  tail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await task()
  } finally {
    waiting -= 1
    release()
  }
}
