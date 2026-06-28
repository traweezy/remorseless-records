import { Button, Link, Section, Text, Img, Hr } from './primitives'
import { Base } from './base'

/**
 * The key for the InviteUserEmail template, used to identify it
 */
export const INVITE_USER = 'invite-user'

/**
 * The props for the InviteUserEmail template
 */
export interface InviteUserEmailProps {
  /**
   * The link that the user can click to accept the invitation
   */
  inviteLink: string
  /**
   * The preview text for the email, appears next to the subject
   * in mail providers like Gmail
   */
  preview?: string
}

/**
 * Type guard for checking if the data is of type InviteUserEmailProps
 * @param data - The data to check
 */
export const isInviteUserData = (data: any): data is InviteUserEmailProps =>
  typeof data.inviteLink === 'string' && (typeof data.preview === 'string' || !data.preview)

/**
 * The InviteUserEmail template component built with email-safe React primitives.
 */
export const InviteUserEmail = ({
  inviteLink,
  preview = `You've been invited to Medusa!`,
}: InviteUserEmailProps) => {
  return (
    <Base preview={preview}>
      <Section style={{ marginTop: 32 }}>
        <Img
          src="https://user-images.githubusercontent.com/59018053/229103275-b5e482bb-4601-46e6-8142-244f531cebdb.svg"
          alt="Medusa"
          style={{ display: 'block', margin: '0 auto', width: 112 }}
        />
      </Section>
      <Section style={{ textAlign: 'center' }}>
        <Text
          style={{
            color: '#000000',
            fontSize: 14,
            lineHeight: '24px',
          }}
        >
          You&apos;ve been invited to be an administrator on <strong>Medusa</strong>.
        </Text>
        <Section style={{ marginBottom: 32, marginTop: 16 }}>
          <Button
            href={inviteLink}
            style={{
              backgroundColor: '#000000',
              borderRadius: 4,
              color: '#ffffff',
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 600,
              padding: '12px 20px',
              textDecoration: 'none',
            }}
          >
            Accept Invitation
          </Button>
        </Section>
        <Text
          style={{
            color: '#000000',
            fontSize: 14,
            lineHeight: '24px',
          }}
        >
          or copy and paste this URL into your browser:
        </Text>
        <Text style={{
          maxWidth: '100%',
          wordBreak: 'break-all',
          overflowWrap: 'break-word'
        }}>
          <Link
            href={inviteLink}
            style={{ color: '#2563eb', textDecoration: 'none' }}
          >
            {inviteLink}
          </Link>
        </Text>
      </Section>
      <Hr
        style={{
          borderTop: '1px solid #eaeaea',
          margin: '26px 0',
          width: '100%',
        }}
      />
      <Text
        style={{
          color: '#666666',
          fontSize: 12,
          lineHeight: '24px',
        }}
      >
        If you were not expecting this invitation, you can ignore this email, as the
        invitation will expire in 24 hours. If you are concerned about your account's safety,
        please reply to this email to get in touch with us.
      </Text>
    </Base>
  )
}

InviteUserEmail.PreviewProps = {
  inviteLink: 'https://mywebsite.com/app/invite?token=abc123ddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
} as InviteUserEmailProps

export default InviteUserEmail
