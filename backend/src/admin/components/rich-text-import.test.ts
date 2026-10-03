import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
} from "lexical"
import { $createLinkNode, LinkNode } from "@lexical/link"
import { $createHeadingNode, HeadingNode } from "@lexical/rich-text"

import { $replaceRichTextRoot } from "./rich-text-import"

describe("rich text root import", () => {
  const editor = () =>
    createEditor({
      nodes: [LinkNode, HeadingNode],
      onError: (error) => {
        throw error
      },
    })

  it("wraps plain text and preserves inline formatting without taking focus", () => {
    editor().update(
      () => {
        $replaceRichTextRoot([
          $createTextNode("Hello "),
          $createTextNode("world").toggleFormat("bold"),
          $createLineBreakNode(),
          $createLinkNode("https://example.com").append(
            $createTextNode("Details")
          ),
        ])
        const root = $getRoot()
        expect(root.getChildren().map((node) => node.getType())).toEqual([
          "paragraph",
        ])
        expect(root.getTextContent()).toBe("Hello world\nDetails")
        expect(root.getAllTextNodes()[1]!.hasFormat("bold")).toBe(true)
        expect($getSelection()).toBeNull()
      },
      { discrete: true }
    )
  })

  it("preserves block order and separates inline runs across blocks", () => {
    editor().update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode("Old")))
        $replaceRichTextRoot([
          $createTextNode("Before"),
          $createHeadingNode("h2").append($createTextNode("Heading")),
          $createTextNode("After"),
        ])
        expect(
          $getRoot()
            .getChildren()
            .map((node) => [node.getType(), node.getTextContent()])
        ).toEqual([
          ["paragraph", "Before"],
          ["heading", "Heading"],
          ["paragraph", "After"],
        ])
      },
      { discrete: true }
    )
  })

  it("replaces empty imports with an editable empty paragraph", () => {
    editor().update(
      () => {
        $replaceRichTextRoot([])
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getType())
        ).toEqual(["paragraph"])
        expect($getRoot().getTextContent()).toBe("")
      },
      { discrete: true }
    )
  })
})
