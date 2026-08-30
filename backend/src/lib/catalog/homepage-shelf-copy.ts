export const homepageShelfCopy = {
  "new-releases": {
    title: "New in Store",
    description: "The latest and greatest, available now",
  },
  featured: {
    title: "Featured Picks",
    description: "Curated selection of albums we can't stop spinning",
  },
} as const

export type HomepageShelfCopyHandle = keyof typeof homepageShelfCopy

export type HomepageShelfCopyRecord = {
  id: string
  handle: string
  title: string
  description: string | null
}

export type HomepageShelfCopyChange = {
  id: string
  handle: HomepageShelfCopyHandle
  before: {
    title: string
    description: string | null
  }
  after: {
    title: string
    description: string
  }
}

const handles = Object.keys(
  homepageShelfCopy
).sort() as HomepageShelfCopyHandle[]

export const planHomepageShelfCopy = (
  records: HomepageShelfCopyRecord[]
): HomepageShelfCopyChange[] => {
  const byHandle = new Map<string, HomepageShelfCopyRecord>()

  records.forEach((record) => {
    if (byHandle.has(record.handle)) {
      throw new Error(
        `[homepage-shelves] Multiple shelves use handle '${record.handle}'.`
      )
    }
    byHandle.set(record.handle, record)
  })

  return handles.flatMap((handle) => {
    const record = byHandle.get(handle)
    if (!record) {
      throw new Error(
        `[homepage-shelves] Required shelf '${handle}' does not exist.`
      )
    }

    const desired = homepageShelfCopy[handle]
    if (
      record.title === desired.title &&
      record.description === desired.description
    ) {
      return []
    }

    return [
      {
        id: record.id,
        handle,
        before: {
          title: record.title,
          description: record.description,
        },
        after: desired,
      },
    ]
  })
}
