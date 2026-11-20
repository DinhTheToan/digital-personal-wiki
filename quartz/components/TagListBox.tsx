import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { resolveRelative } from "../util/path"

interface Options {
  title?: string
}

interface TagNode {
  name: string
  fullPath: string
  count: number
  children: Map<string, TagNode>
}

const defaultOptions: Options = {
  title: "Danh sách thẻ",
}

export default ((userOpts?: Options) => {
  const opts = { ...defaultOptions, ...userOpts }

  const TagListBox: QuartzComponent = ({ allFiles, fileData, displayClass }: QuartzComponentProps) => {
    const root = new Map<string, TagNode>()

    for (const file of allFiles) {
      const tags = file.frontmatter?.tags ?? []
      const seenInFile = new Set<string>()

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
          const node = currentMap.get(part)!
          if (!seenInFile.has(currentPath)) {
            node.count += 1
            seenInFile.add(currentPath)
          }
          currentMap = node.children
        }
      }
    }

    if (root.size === 0) {
      return null
    }

    const renderNodes = (nodes: Map<string, TagNode>) => {
      const sorted = Array.from(nodes.values()).sort((a, b) =>
        a.name.localeCompare(b.name, "vi")
      )

      return (
        <ul className="tag-tree-list">
          {sorted.map((node) => {
            const hasChildren = node.children.size > 0
            const slug = `tags/${node.fullPath.toLowerCase().replace(/\s+/g, "-")}` as any
            const href = resolveRelative(fileData.slug!, slug)

            if (hasChildren) {
              return (
                <li key={node.fullPath} className="tag-tree-folder">
                  <details open>
                    <summary className="tag-tree-row">
                      <span className="tag-caret">›</span>
                      <a href={href} className="internal tag-tree-label">
                        {node.name}
                      </a>
                      <span className="tag-tree-count">{node.count}</span>
                    </summary>
                    {renderNodes(node.children)}
                  </details>
                </li>
              )
            }

            return (
              <li key={node.fullPath} className="tag-tree-leaf">
                <div className="tag-tree-row">
                  <a href={href} className="internal tag-tree-label">
                    {node.name}
                  </a>
                  <span className="tag-tree-count">{node.count}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )
    }

    return (
      <div className={classNames(displayClass, "tag-listbox")}>
        <h3>{opts.title}</h3>
        {renderNodes(root)}
      </div>
    )
  }

  return TagListBox
}) satisfies QuartzComponentConstructor