type ProductTracklistProps = {
  tracks: readonly string[]
}

export const ProductTracklist = ({ tracks }: ProductTracklistProps) => {
  // Imported lists may already include their sequential track numbers. Keep
  // every authored title intact and avoid adding a second visible number.
  const authoredNumbers = tracks.every((track, index) => {
    const prefix = /^0*(\d+)[.)]\s+\S/u.exec(track)
    return prefix !== null && Number(prefix[1]) === index + 1
  })

  return (
    <ol className="space-y-2 text-sm leading-relaxed text-muted-foreground">
      {tracks.map((track, index) => (
        <li key={`track-${index}`} className="flex items-baseline gap-3">
          {!authoredNumbers ? (
            <span
              aria-hidden="true"
              className="text-xs font-mono uppercase tracking-[0.35rem] text-muted-foreground"
            >
              {(index + 1).toString().padStart(2, "0")}
            </span>
          ) : null}
          <span className="min-w-0 break-words">{track}</span>
        </li>
      ))}
    </ol>
  )
}
