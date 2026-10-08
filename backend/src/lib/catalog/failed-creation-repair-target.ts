const target = {
  RAILWAY_PROJECT_ID: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
  RAILWAY_ENVIRONMENT_ID: "799a2f98-f819-495d-b8b6-12e71af86568",
  RAILWAY_SERVICE_ID: "99d4fd5e-955b-416a-9078-0266bcf949d2",
} as const
export const verifyFailedCreationRepairTarget = (
  environment: NodeJS.ProcessEnv,
  sha: string
): void => {
  if (
    !/^[a-f0-9]{40}$/u.test(sha) ||
    environment.RAILWAY_GIT_COMMIT_SHA !== sha ||
    Object.entries(target).some(([name, value]) => environment[name] !== value)
  ) {
    throw new Error(
      "Failed-creation repair requires the exact deployed staging Backend target."
    )
  }
}
