"use client"

import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { Button, Text } from "@medusajs/ui"

type RichTextEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

type ToolbarAction = {
  label: string
  command: string
  value?: string
}

const toolbarActions: ToolbarAction[] = [
  { label: "Bold", command: "bold" },
  { label: "Italic", command: "italic" },
  { label: "Underline", command: "underline" },
  { label: "H2", command: "formatBlock", value: "h2" },
  { label: "H3", command: "formatBlock", value: "h3" },
  { label: "Quote", command: "formatBlock", value: "blockquote" },
  { label: "Bullet", command: "insertUnorderedList" },
  { label: "Number", command: "insertOrderedList" },
  { label: "Clear", command: "removeFormat" },
] as const

type EditorNode = { innerHTML?: string; focus?: () => void }

const RichTextEditor = memo<RichTextEditorProps>(
  ({ value, onChange, placeholder }) => {
    const editorRef = useRef<HTMLDivElement | null>(null)

    const getEditorNode = useCallback(
      () => editorRef.current as unknown as EditorNode | null,
      []
    )

    useEffect(() => {
      const editor = getEditorNode()
      if (!editor) {
        return
      }
      const activeElement = (globalThis as { document?: { activeElement?: unknown } })
        .document?.activeElement
      if (activeElement === editorRef.current) {
        return
      }
      if (editor.innerHTML !== value) {
        editor.innerHTML = value
      }
    }, [getEditorNode, value])

    const syncValue = useCallback(() => {
      const editor = getEditorNode()
      if (!editor) {
        return
      }
      onChange(editor.innerHTML ?? "")
    }, [getEditorNode, onChange])

    const exec = useCallback(
      (command: string, commandValue?: string) => {
        const editor = getEditorNode()
        if (!editor) {
          return
        }
        editor.focus?.()
        const execCommand = (
          globalThis as {
            document?: {
              execCommand?: (
                cmd: string,
                showUi?: boolean,
                value?: string
              ) => boolean
            }
          }
        ).document?.execCommand
        execCommand?.(command, false, commandValue)
        syncValue()
      },
      [getEditorNode, syncValue]
    )

    const handleLink = useCallback(() => {
      const promptFn = (globalThis as { prompt?: (message: string) => string | null })
        .prompt
      const url = promptFn ? promptFn("Enter URL")?.trim() : ""
      if (!url) {
        return
      }
      exec("createLink", url)
    }, [exec])

    const actions = useMemo(
      () =>
        toolbarActions.map((action) => ({
          ...action,
          onClick: () => exec(action.command, action.value),
        })),
      [exec]
    )

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              size="small"
              variant="secondary"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
          <Button
            type="button"
            size="small"
            variant="secondary"
            onClick={handleLink}
          >
            Link
          </Button>
        </div>
        <div
          ref={editorRef}
          className="min-h-[220px] w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm leading-relaxed text-ui-fg-base shadow-sm outline-none focus:border-ui-border-strong"
          contentEditable
          role="textbox"
          aria-multiline="true"
          onInput={syncValue}
          suppressContentEditableWarning
        />
        {placeholder ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {placeholder}
          </Text>
        ) : null}
      </div>
    )
  }
)

RichTextEditor.displayName = "RichTextEditor"

export default RichTextEditor
