export function onRequestError(error) {
  console.log(
    JSON.stringify({
      event: "fixture.request.error",
      name: error.name,
      message: error.message,
    })
  )
}
