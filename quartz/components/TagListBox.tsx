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

    const renderNodes = (nodes: Map<string, TagNode>, isRoot = false) => {
      const sorted = Array.from(nodes.values()).sort((a, b) =>
        a.name.localeCompare(b.name, "vi")
      )

      return (
        <ul className={classNames("tag-tree-list", isRoot ? "tag-tree-root" : "tag-tree-sub")}>
          {sorted.map((node) => {
            const hasChildren = node.children.size > 0
            const slug = `tags/${node.fullPath.toLowerCase().replace(/\s+/g, "-")}` as any
            const href = resolveRelative(fileData.slug!, slug)

            if (hasChildren) {
              return (
                <li key={node.fullPath} className="tag-tree-item tag-tree-folder">
                  <details open>
                    <summary className="tag-tree-row">
                      <span className="tag-caret-wrapper">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="tag-caret"
                        >
                          <polyline points="9 6 15 12 9 18"></polyline>
                        </svg>
                      </span>
                      <a href={href} className="internal tag-tree-label">
                        {node.name}
                      </a>
                      <span className="tag-tree-count">{node.count}</span>
                    </summary>
                    {renderNodes(node.children, false)}
                  </details>
                </li>
              )
            }

            return (
              <li key={node.fullPath} className="tag-tree-item tag-tree-leaf">
                <div className="tag-tree-row">
                  <span className="tag-caret-spacer"></span>
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
        {opts.title && <h3>{opts.title}</h3>}
        {renderNodes(root, true)}
      </div>
    )
  }

  TagListBox.css = `
.tag-listbox {
  min-height: 0;
  overflow-y: auto;
  margin-top: 1rem;
}

.tag-listbox > h3 {
  margin: 0.5rem 0;
  font-size: 1rem;
  color: var(--dark);
}

.tag-tree-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.tag-tree-sub {
  margin-left: 0.75rem;
  padding-left: 0.75rem;
  border-left: 1px solid var(--lightgray);
}

.tag-tree-item {
  margin: 0.15rem 0;
}

.tag-tree-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.4rem;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}

.tag-tree-row:hover {
  background-color: var(--highlight);
}

details > summary {
  list-style: none;
}

details > summary::-webkit-details-marker {
  display: none;
}

.tag-caret-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.tag-caret {
  width: 0.75rem;
  height: 0.75rem;
  color: var(--gray);
  transition: transform 0.15s ease;
}

details[open] > summary .tag-caret {
  transform: rotate(90deg);
}

.tag-caret-spacer {
  width: 0.3rem;
  flex-shrink: 0;
}

.tag-tree-label {
  flex-grow: 1;
  text-decoration: none;
  color: var(--darkgray);
  font-size: 0.9rem;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-tree-row:hover .tag-tree-label {
  color: var(--secondary);
}

.tag-tree-count {
  font-size: 0.8rem;
  color: var(--gray);
  min-width: 1.2rem;
  text-align: right;
  flex-shrink: 0;
}
`

  return TagListBox
}) satisfies QuartzComponentConstructor
