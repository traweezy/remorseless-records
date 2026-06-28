import type {
  AnchorHTMLAttributes,
  CSSProperties,
  ImgHTMLAttributes,
  PropsWithChildren,
  ReactElement,
} from 'react'

type StyleProps = {
  style?: CSSProperties
}

const mergeStyles = (
  base: CSSProperties,
  override: CSSProperties | undefined
): CSSProperties => ({
  ...base,
  ...override,
})

export const Html = ({ children }: PropsWithChildren): ReactElement => (
  <html lang="en">{children}</html>
)

export const Head = (): ReactElement => (
  <head>
    <meta content="text/html; charset=UTF-8" httpEquiv="Content-Type" />
    <meta content="width=device-width, initial-scale=1.0" name="viewport" />
  </head>
)

export const Preview = ({ children }: PropsWithChildren): ReactElement => (
  <div
    style={{
      display: 'none',
      maxHeight: 0,
      maxWidth: 0,
      opacity: 0,
      overflow: 'hidden',
      lineHeight: '1px',
    }}
  >
    {children}
  </div>
)

export const Body = ({
  children,
  style,
}: PropsWithChildren<StyleProps>): ReactElement => (
  <body style={style}>{children}</body>
)

export const Container = ({
  children,
  style,
}: PropsWithChildren<StyleProps>): ReactElement => (
  <div style={style}>{children}</div>
)

export const Section = ({
  children,
  style,
}: PropsWithChildren<StyleProps>): ReactElement => (
  <section style={style}>{children}</section>
)

export const Text = ({
  children,
  style,
}: PropsWithChildren<StyleProps>): ReactElement => (
  <p style={mergeStyles({ margin: '0 0 16px' }, style)}>{children}</p>
)

export const Hr = ({ style }: StyleProps): ReactElement => (
  <hr
    style={mergeStyles(
      {
        border: 0,
        borderTop: '1px solid #eaeaea',
        margin: '20px 0',
        width: '100%',
      },
      style
    )}
  />
)

export const Link = ({
  children,
  href,
  style,
  ...attributes
}: PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement> & StyleProps>): ReactElement => (
  <a {...attributes} href={href} style={style}>
    {children}
  </a>
)

export const Button = ({
  children,
  href,
  style,
  ...attributes
}: PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement> & StyleProps>): ReactElement => (
  <a {...attributes} href={href} style={style}>
    {children}
  </a>
)

export const Img = ({
  alt,
  src,
  style,
  ...attributes
}: ImgHTMLAttributes<HTMLImageElement> & StyleProps): ReactElement => (
  <img {...attributes} alt={alt} src={src} style={style} />
)
