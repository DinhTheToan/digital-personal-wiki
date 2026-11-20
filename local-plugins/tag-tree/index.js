import { h } from "preact"

function TagTreeComponent({ allFiles, fileData, displayClass }) {
  const root = new Map()

  for (const file of allFiles ?? []) {
    const tags = file.frontmatter?.tags ?? []
    const seenInFile = new Set()

    for (const rawTag of tags) {
      const cleanTag = String(rawTag).trim().replace(/^#/, "")
      if (!cleanTag) continue

      const parts = cleanTag.split("/").filter(Boolean)
      let currentMap = root
      let currentPath = ""

      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part
        if (!currentMap.has(part)) {
          currentMap.set(part, {
            name: part,
            fullPath: currentPath,
            count: 0,
            children: new Map(),
          })
        }
        const node = currentMap.get(part)
        if (!seenInFile.has(currentPath)) {
          node.count += 1
          seenInFile.add(currentPath)
        }
        currentMap = node.children
      }
    }
  }

  if (root.size === 0) return null

  const currentSlug = String(fileData?.slug ?? "index")
  const depth = currentSlug === "index" ? 0 : currentSlug.split("/").length - 1
  const prefix = depth > 0 ? "../".repeat(depth) : "./"

  const renderNodes = (nodes) => {
    const sorted = Array.from(nodes.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "vi")
    )

    return h(
      "ul",
      { class: "tag-tree-list" },
      sorted.map((node) => {
        const hasChildren = node.children.size > 0
        const slug = `tags/${node.fullPath.toLowerCase().replace(/\s+/g, "-")}`
        const href = `${prefix}${slug}`

        if (hasChildren) {
          return h(
            "li",
            { key: node.fullPath, class: "tag-tree-folder" },
            h(
              "details",
              { open: true },
              [
                h(
                  "summary",
                  { class: "tag-tree-row" },
                  [
                    h("span", { class: "tag-caret" }, "›"),
                    h("a", { href, class: "internal tag-tree-label" }, node.name),
                    h("span", { class: "tag-tree-count" }, String(node.count)),
                  ]
                ),
                renderNodes(node.children),
              ]
            )
          )
        }

        return h(
          "li",
          { key: node.fullPath, class: "tag-tree-leaf" },
          h(
            "div",
            { class: "tag-tree-row" },
            [
              h("a", { href, class: "internal tag-tree-label" }, node.name),
              h("span", { class: "tag-tree-count" }, String(node.count)),
            ]
          )
        )
      })
    )
  }

  return h(
    "div",
    { class: `${displayClass ?? ""} tag-listbox`.trim() },
    [h("h3", null, "Danh sách thẻ"), renderNodes(root)]
  )
}

export default {
  name: "TagTree",
  component: () => TagTreeComponent,
}
