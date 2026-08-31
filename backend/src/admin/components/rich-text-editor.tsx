"use client"

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactElement,
} from "react"
import { HistoryExtension } from "@lexical/history"
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html"
import { LinkExtension, TOGGLE_LINK_COMMAND } from "@lexical/link"
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListExtension,
} from "@lexical/list"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import {
  ReactExtension,
  type EditorChildrenComponentProps,
} from "@lexical/react/ReactExtension"
import {
  $createHeadingNode,
  $createQuoteNode,
  RichTextExtension,
} from "@lexical/rich-text"
import { $setBlocksType } from "@lexical/selection"
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  configExtension,
  defineExtension,
  FORMAT_TEXT_COMMAND,
  type TextFormatType,
} from "lexical"
import { Button, Input, Label, Text } from "@medusajs/ui"

const EXTERNAL_SYNC_TAG = "remorseless-external-html"

const ToolbarFirstEditorChildrenView = memo<EditorChildrenComponentProps>(
  ({ children, contentEditable }) => (
    <>
      {children}
      <div className="relative">{contentEditable}</div>
    </>
  )
)

ToolbarFirstEditorChildrenView.displayName = "ToolbarFirstEditorChildrenView"

// Lexical requires a callable returning JSX.Element | null, while React 18's
// memo exotic component is typed as returning the broader ReactNode union.
const ToolbarFirstEditorChildren = (
  props: EditorChildrenComponentProps
): ReactElement => <ToolbarFirstEditorChildrenView {...props} />

const editorExtension = defineExtension({
  dependencies: [
    configExtension(ReactExtension, {
      EditorChildrenComponent: ToolbarFirstEditorChildren,
    }),
    RichTextExtension,
    HistoryExtension,
    LinkExtension,
    ListExtension,
  ],
  name: "remorseless-rich-text",
  namespace: "RemorselessRichText",
  theme: {
    heading: {
      h2: "my-3 text-xl font-semibold",
      h3: "my-2 text-lg font-semibold",
    },
    link: "text-ui-fg-interactive underline underline-offset-2",
    list: {
      listitem: "ml-5",
      nested: { listitem: "ml-4" },
      ol: "my-2 list-decimal pl-5",
      ul: "my-2 list-disc pl-5",
    },
    paragraph: "my-2",
    quote: "my-3 border-l-2 border-ui-border-strong pl-4 text-ui-fg-subtle",
    text: {
      bold: "font-semibold",
      italic: "italic",
      underline: "underline",
    },
  },
})

type RichTextEditorProps = {
  ariaDescribedBy?: string
  ariaLabel?: string
  disabled?: boolean
  error?: string
  id?: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  value: string
}

type RichTextContentConfig = {
  ariaDescribedBy: string | undefined
  ariaLabel: string
  disabled: boolean
  error: string | undefined
  id: string | undefined
  onBlur: (() => void) | undefined
  placeholder: string
}

const RichTextContentContext = createContext<RichTextContentConfig | null>(null)

const RichTextContentEditable = memo(() => {
  const config = useContext(RichTextContentContext)
  if (!config) {
    return null
  }
  const {
    ariaDescribedBy,
    ariaLabel,
    disabled,
    error,
    id,
    onBlur,
    placeholder,
  } = config
  return (
    <ContentEditable
      aria-describedby={ariaDescribedBy}
      aria-invalid={error ? true : undefined}
      aria-label={ariaLabel}
      aria-multiline="true"
      aria-placeholder={placeholder}
      className="min-h-64 w-full px-4 py-3 text-sm leading-relaxed text-ui-fg-base outline-none focus-visible:ring-2 focus-visible:ring-ui-border-interactive disabled:cursor-not-allowed"
      id={id}
      onBlur={onBlur}
      placeholder={
        <span className="pointer-events-none absolute left-4 top-3 text-sm text-ui-fg-subtle">
          {placeholder}
        </span>
      }
      readOnly={disabled}
      role="textbox"
    />
  )
})

RichTextContentEditable.displayName = "RichTextContentEditable"

const stableContentEditable = <RichTextContentEditable />

type HtmlSyncPluginProps = {
  syncedHtmlRef: MutableRefObject<string | null>
  value: string
}

const HtmlSyncPlugin = memo<HtmlSyncPluginProps>(({ syncedHtmlRef, value }) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (syncedHtmlRef.current === value) {
      return
    }
    syncedHtmlRef.current = value
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        if (!value.trim()) {
          root.append($createParagraphNode())
          return
        }
        const document = new globalThis.DOMParser().parseFromString(
          value,
          "text/html"
        )
        const nodes = $generateNodesFromDOM(editor, document)
        root.append(...(nodes.length ? nodes : [$createParagraphNode()]))
      },
      { tag: EXTERNAL_SYNC_TAG }
    )
  }, [editor, syncedHtmlRef, value])

  return null
})

HtmlSyncPlugin.displayName = "HtmlSyncPlugin"

type EditorToolbarProps = {
  disabled: boolean
}

type ToolbarAction =
  | "bold"
  | "bullet"
  | "clear"
  | "h2"
  | "h3"
  | "italic"
  | "number"
  | "paragraph"
  | "quote"
  | "underline"

const toolbarActions: ReadonlyArray<{
  action: ToolbarAction
  label: string
}> = [
  { action: "paragraph", label: "Text" },
  { action: "h2", label: "H2" },
  { action: "h3", label: "H3" },
  { action: "bold", label: "Bold" },
  { action: "italic", label: "Italic" },
  { action: "underline", label: "Underline" },
  { action: "quote", label: "Quote" },
  { action: "bullet", label: "Bullets" },
  { action: "number", label: "Numbers" },
  { action: "clear", label: "Clear style" },
]

const isToolbarAction = (value: string | undefined): value is ToolbarAction =>
  toolbarActions.some(({ action }) => action === value)

const normalizeLink = (value: string): string | null => {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  try {
    const url = new URL(normalized)
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

const EditorToolbar = memo<EditorToolbarProps>(({ disabled }) => {
  const [editor] = useLexicalComposerContext()
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkError, setLinkError] = useState<string | null>(null)
  const [formats, setFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
  })

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection()
          setFormats({
            bold: $isRangeSelection(selection) && selection.hasFormat("bold"),
            italic:
              $isRangeSelection(selection) && selection.hasFormat("italic"),
            underline:
              $isRangeSelection(selection) && selection.hasFormat("underline"),
          })
        })
      }),
    [editor]
  )

  const handleToolbarMouseDown = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
    },
    []
  )
  const handleToolbarAction = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const action = event.currentTarget.dataset.action
      if (!isToolbarAction(action) || disabled) {
        return
      }
      if (["bold", "italic", "underline"].includes(action)) {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, action as TextFormatType)
        return
      }
      if (action === "bullet" || action === "number") {
        editor.dispatchCommand(
          action === "bullet"
            ? INSERT_UNORDERED_LIST_COMMAND
            : INSERT_ORDERED_LIST_COMMAND,
          undefined
        )
        return
      }
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          return
        }
        if (action === "clear") {
          selection.getNodes().forEach((node) => {
            if ($isTextNode(node)) {
              node.setFormat(0)
              node.setStyle("")
            }
          })
          $setBlocksType(selection, () => $createParagraphNode())
          return
        }
        $setBlocksType(selection, () => {
          if (action === "h2" || action === "h3") {
            return $createHeadingNode(action)
          }
          if (action === "quote") {
            return $createQuoteNode()
          }
          return $createParagraphNode()
        })
      })
    },
    [disabled, editor]
  )
  const handleLinkToggle = useCallback(() => {
    setLinkError(null)
    setLinkOpen((current) => !current)
  }, [])
  const handleLinkChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setLinkUrl(event.currentTarget.value)
      setLinkError(null)
    },
    []
  )
  const handleLinkApply = useCallback(() => {
    const normalized = normalizeLink(linkUrl)
    if (!normalized) {
      setLinkError("Enter a complete http, https, or mailto URL.")
      return
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, normalized)
    setLinkUrl("")
    setLinkError(null)
    setLinkOpen(false)
    editor.focus()
  }, [editor, linkUrl])
  const handleLinkRemove = useCallback(() => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    setLinkUrl("")
    setLinkError(null)
    setLinkOpen(false)
    editor.focus()
  }, [editor])

  return (
    <div className="border-b border-ui-border-base bg-ui-bg-subtle p-2">
      <div
        aria-label="Text formatting"
        className="flex flex-wrap gap-1"
        role="toolbar"
      >
        {toolbarActions.map(({ action, label }) => (
          <Button
            aria-pressed={
              action === "bold" || action === "italic" || action === "underline"
                ? formats[action]
                : undefined
            }
            data-action={action}
            disabled={disabled}
            key={action}
            onClick={handleToolbarAction}
            onMouseDown={handleToolbarMouseDown}
            size="small"
            type="button"
            variant="transparent"
          >
            {label}
          </Button>
        ))}
        <Button
          aria-expanded={linkOpen}
          disabled={disabled}
          onClick={handleLinkToggle}
          size="small"
          type="button"
          variant="transparent"
        >
          Link
        </Button>
      </div>
      {linkOpen ? (
        <div className="mt-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
          <Label htmlFor="rich-text-link">Link destination</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              aria-describedby={linkError ? "rich-text-link-error" : undefined}
              aria-invalid={linkError ? true : undefined}
              autoComplete="url"
              className="min-w-52 flex-1"
              id="rich-text-link"
              onChange={handleLinkChange}
              placeholder="https://example.com"
              type="url"
              value={linkUrl}
            />
            <Button onClick={handleLinkApply} size="small" type="button">
              Apply
            </Button>
            <Button
              onClick={handleLinkRemove}
              size="small"
              type="button"
              variant="secondary"
            >
              Remove link
            </Button>
          </div>
          {linkError ? (
            <Text
              className="mt-1 text-ui-fg-error"
              id="rich-text-link-error"
              size="xsmall"
            >
              {linkError}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

EditorToolbar.displayName = "EditorToolbar"

const RichTextEditor = memo<RichTextEditorProps>(
  ({
    ariaDescribedBy,
    ariaLabel = "Rich text editor",
    disabled = false,
    error,
    id,
    onBlur,
    onChange,
    placeholder = "Start writing…",
    value,
  }) => {
    const syncedHtmlRef = useRef<string | null>(null)
    const handleChange = useCallback(
      (
        _editorState: unknown,
        editor: Parameters<typeof $generateHtmlFromNodes>[0],
        tags: Set<string>
      ) => {
        if (tags.has(EXTERNAL_SYNC_TAG)) {
          return
        }
        editor.read(() => {
          const html = $generateHtmlFromNodes(editor)
          syncedHtmlRef.current = html
          onChange(html)
        })
      },
      [onChange]
    )
    const contentConfig = useMemo<RichTextContentConfig>(
      () => ({
        ariaDescribedBy,
        ariaLabel,
        disabled,
        error,
        id,
        onBlur,
        placeholder,
      }),
      [ariaDescribedBy, ariaLabel, disabled, error, id, onBlur, placeholder]
    )

    return (
      <RichTextContentContext.Provider value={contentConfig}>
        <div className="relative overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-base shadow-sm focus-within:border-ui-border-interactive">
          <LexicalExtensionComposer
            contentEditable={stableContentEditable}
            extension={editorExtension}
          >
            <EditorToolbar disabled={disabled} />
            <HtmlSyncPlugin syncedHtmlRef={syncedHtmlRef} value={value} />
            <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
          </LexicalExtensionComposer>
        </div>
      </RichTextContentContext.Provider>
    )
  }
)

RichTextEditor.displayName = "RichTextEditor"

export default RichTextEditor
