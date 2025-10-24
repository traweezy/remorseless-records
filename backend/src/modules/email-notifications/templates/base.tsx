import {
  Html,
  Body,
  Container,
  Preview,
  Tailwind,
  Head,
} from '@react-email/components'
import type { PropsWithChildren, ReactElement } from 'react'

type BaseProps = {
  preview?: string
}

export const Base = ({ preview, children }: PropsWithChildren<BaseProps>): ReactElement => (
  <Html>
    <Head />
    {preview ? <Preview>{preview}</Preview> : null}
    <Tailwind>
      <Body className="bg-white my-auto mx-auto font-sans px-2">
        <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] w-full overflow-hidden">
          <div className="max-w-full break-words">{children}</div>
        </Container>
      </Body>
    </Tailwind>
  </Html>
)
