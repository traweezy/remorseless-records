import { randomUUID } from "node:crypto"

import {
  parseFailedCreationRepairArguments,
  verifyFailedCreationRepairTarget,
} from "./repair-failed-catalog-creation"

const sha = "a".repeat(40)
const preview = [
  `--sha=${sha}`,
  "--creation-operation-id=catop_owned",
  "--product-id=prod_owned",
]
const environment = {
  RAILWAY_PROJECT_ID: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
  RAILWAY_ENVIRONMENT_ID: "799a2f98-f819-495d-b8b6-12e71af86568",
  RAILWAY_SERVICE_ID: "99d4fd5e-955b-416a-9078-0266bcf949d2",
  RAILWAY_GIT_COMMIT_SHA: sha,
}

describe("failed-creation operator guards", () => {
  it("defaults to preview and admits only an exact reviewed apply", () => {
    expect(parseFailedCreationRepairArguments(preview)).toMatchObject({
      apply: false,
      sha,
    })
    expect(
      parseFailedCreationRepairArguments([
        ...preview,
        "--apply",
        `--manifest-sha256=${"b".repeat(64)}`,
        `--idempotency-key=${randomUUID()}`,
      ])
    ).toMatchObject({ apply: true, sha })
    expect(() =>
      verifyFailedCreationRepairTarget(environment, sha)
    ).not.toThrow()
  })
  it.each(
    [
      [],
      ["--apply"],
      ["--apply", `--manifest-sha256=${"b".repeat(64)}`],
      [`--manifest-sha256=${"b".repeat(64)}`],
      [`--idempotency-key=${randomUUID()}`],
      ["--apply", "--apply"],
      ["--unknown=x"],
      [`--sha=${sha}`],
      ["--apply", "--manifest-sha256=wrong", "--idempotency-key=wrong"],
      ["--product-id=prod_second"],
      ["--creation-operation-id=catop_second"],
    ].map((extra) => ({ extra }))
  )(
    "rejects missing, duplicate and unreviewed arguments $extra",
    ({ extra }) => {
      const args = extra.length ? [...preview, ...extra] : []
      expect(() => parseFailedCreationRepairArguments(args)).toThrow()
    }
  )
  it.each(Object.keys(environment))(
    "rejects missing or changed target field %s",
    (field) => {
      expect(() =>
        verifyFailedCreationRepairTarget(
          { ...environment, [field]: undefined },
          sha
        )
      ).toThrow("exact deployed staging")
      expect(() =>
        verifyFailedCreationRepairTarget(
          { ...environment, [field]: "wrong" },
          sha
        )
      ).toThrow("exact deployed staging")
    }
  )
})
