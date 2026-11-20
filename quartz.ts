import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { componentRegistry } from "./quartz/components/registry"
import TagListBox from "./quartz/components/TagListBox"

// Đăng ký TagListBox (cây thẻ) vào component registry với tên "tag-tree"
componentRegistry.register("tag-tree", TagListBox, "local/tag-tree", {
  name: "tag-tree",
  displayName: "Tag Tree",
  description: "Cây thẻ phân cấp ở sidebar trái",
  version: "1.0.0",
  defaultPosition: "left",
  defaultPriority: 55,
})

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
