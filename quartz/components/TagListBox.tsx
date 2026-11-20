import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { resolveRelative } from "../util/path"

interface Options {
  title?: string
}

const defaultOptions: Options = {
  title: "Chủ đề (Tags)",
}

export default ((userOpts?: Options) => {
  const opts = { ...defaultOptions, ...userOpts }

  const TagListBox: QuartzComponent = ({ allFiles, fileData, displayClass }: QuartzComponentProps) => {
    const tagCounts = new Map<string, number>()

    for (const file of allFiles) {
      const tags = file.frontmatter?.tags ?? []
      for (const rawTag of tags) {
        const tag = String(rawTag).trim()
        if (!tag) continue
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }

    const sortedTags = Array.from(tagCounts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "vi")
    )

    if (sortedTags.length === 0) {
      return null
    }

    return (
      <div className={classNames(displayClass, "tag-listbox")}>
        <h3>{opts.title}</h3>
        <ul className="tag-listbox-items">
          {sortedTags.map(([tag, count]) => {
            const slug = `tags/${tag.toLowerCase().replace(/\s+/g, "-")}` as any
            const href = resolveRelative(fileData.slug!, slug)
            return (
              <li key={tag}>
                <a href={href} className="internal tag-link">
                  #{tag} <span className="tag-count">({count})</span>
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  TagListBox.css = `
  .tag-listbox {
    margin-top: 1.5rem;
  }
  .tag-listbox h3 {
    font-size: 1rem;
    margin-bottom: 0.6rem;
  }
  .tag-listbox-items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .tag-listbox-items li a {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.55rem;
    border-radius: 6px;
    background-color: var(--highlight);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .tag-count {
    opacity: 0.7;
    font-size: 0.78rem;
  }
  `

  return TagListBox
}) satisfies QuartzComponentConstructor