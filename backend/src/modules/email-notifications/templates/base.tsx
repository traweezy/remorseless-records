import { Html, Body, Container, Preview, Head } from "./primitives"
import type { PropsWithChildren, ReactElement } from "react"

type BaseProps = {
  preview?: string
  title?: string
}

export const Base = ({
  preview,
  title,
  children,
}: PropsWithChildren<BaseProps>): ReactElement => (
  <Html>
    <Head title={title ?? "Email from Remorseless Records"} />
    <Body
      style={{
        backgroundColor: "#ffffff",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        margin: "auto",
        padding: "0 8px",
      }}
    >
      {preview ? <Preview>{preview}</Preview> : null}
      <Container
        style={{
          border: "1px solid #eaeaea",
          borderRadius: 4,
          boxSizing: "border-box",
          margin: "40px auto",
          maxWidth: 465,
          overflow: "hidden",
          padding: 20,
          width: "100%",
        }}
      >
        <div style={{ maxWidth: "100%", overflowWrap: "break-word" }}>
          {children}
        </div>
      </Container>
    </Body>
  </Html>
)
