import { homepageShelfCopy, planHomepageShelfCopy } from "./homepage-shelf-copy"

describe("planHomepageShelfCopy", () => {
  const records = [
    {
      id: "shelf_new",
      handle: "new-releases",
      title: "Newest Arrivals",
      description: "Old newest description",
    },
    {
      id: "shelf_featured",
      handle: "featured",
      title: "Featured Picks",
      description: "Old featured description",
    },
    {
      id: "shelf_staff",
      handle: "staff-picks",
      title: "Staff Signals",
      description: "Preserve this shelf",
    },
  ]

  it("plans only the two approved copy changes in stable handle order", () => {
    expect(planHomepageShelfCopy(records)).toEqual([
      {
        id: "shelf_featured",
        handle: "featured",
        before: {
          title: "Featured Picks",
          description: "Old featured description",
        },
        after: homepageShelfCopy.featured,
      },
      {
        id: "shelf_new",
        handle: "new-releases",
        before: {
          title: "Newest Arrivals",
          description: "Old newest description",
        },
        after: homepageShelfCopy["new-releases"],
      },
    ])
  })

  it("is idempotent and leaves the retained staff shelf untouched", () => {
    const current = records.map((record) => {
      const desired =
        record.handle === "featured" || record.handle === "new-releases"
          ? homepageShelfCopy[record.handle]
          : null
      return desired ? { ...record, ...desired } : record
    })

    expect(planHomepageShelfCopy(current)).toEqual([])
    expect(current.find(({ handle }) => handle === "staff-picks")).toEqual(records[2])
  })

  it("fails closed when a required handle is missing or duplicated", () => {
    expect(() => planHomepageShelfCopy(records.slice(1))).toThrow(
      "Required shelf 'new-releases' does not exist"
    )
    expect(() => planHomepageShelfCopy([...records, records[0]!])).toThrow(
      "Multiple shelves use handle 'new-releases'"
    )
  })
})
