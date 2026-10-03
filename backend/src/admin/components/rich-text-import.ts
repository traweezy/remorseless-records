import {
  $createParagraphNode,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  type LexicalNode,
  type ParagraphNode,
} from "lexical"

// HTML import can return bare text, line breaks, or inline elements. Root
// children must be blocks; preserve contiguous inline content in a paragraph.
export const $replaceRichTextRoot = (nodes: LexicalNode[]): void => {
  const root = $getRoot()
  root.clear()
  let paragraph: ParagraphNode | null = null
  for (const node of nodes) {
    if (($isElementNode(node) || $isDecoratorNode(node)) && !node.isInline()) {
      paragraph = null
      root.append(node)
    } else {
      if (!paragraph) {
        paragraph = $createParagraphNode()
        root.append(paragraph)
      }
      paragraph.append(node)
    }
  }
  if (root.isEmpty()) root.append($createParagraphNode())
}
