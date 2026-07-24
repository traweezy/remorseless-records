"use client"

type HoneypotFieldProps = {
  name?: string
  value: string
  onChange: (value: string) => void
}

export const HoneypotField = ({
  name = "company",
  value,
  onChange,
}: HoneypotFieldProps) => (
  <input
    type="text"
    name={name}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className="hidden"
    autoComplete="off"
    aria-hidden
    tabIndex={-1}
  />
)
