import type { DialogSpec, ExportDialog, ImportDialog } from "../../bridge/contracts";
import { button, field, notice, selectField } from "../../shared/ui/html";
/** Uses the same real decoder for Operit/Tavern characters and complete owner backups. */
export function importSpec(dialog: ImportDialog): DialogSpec {
  const format = dialog.target === "card" ? selectField("角色格式", "format", dialog.format, [{ id: "operit", label: "Operit JSON" }, { id: "tavern", label: "Tavern JSON" }], false) : "";
  const strategy = dialog.target === "memory" ? selectField("相同 UUID 记忆处理", "strategy", dialog.strategy, [{ id: "SKIP", label: "跳过" }, { id: "UPDATE", label: "更新" }, { id: "CREATE_NEW", label: "创建新记忆" }], false) : "";
  return { title: dialog.target === "card" ? "导入角色 JSON" : dialog.target === "memory" ? "导入记忆 JSON" : "导入群组 JSON", style: "large", tabs: [], body: format + strategy + field(dialog.target === "memory" ? "粘贴记忆 JSON" : dialog.target === "card" && dialog.format === "tavern" ? "粘贴 Tavern JSON" : "粘贴 Operit JSON", "content", dialog.content, 18) + notice(dialog.target === "memory" ? "导入完整记忆、关系、文档分块及 USER.md。导入前建议先导出备份；只修改当前记忆库。" : "角色卡支持 Operit 和 Tavern JSON；群组使用 Operit JSON。"), footer: button("close-dialog", "取消", "") + button("read-import", "导入", "", "", "filled") };
}
/** Exports exact serializer output to a host-confirmed path. */
export function exportSpec(dialog: ExportDialog): DialogSpec {
  return { title: "导出 JSON", style: "large", tabs: [], body: field("导出文件 VFS 路径 *", "path", dialog.path) + field("JSON 内容", "content", dialog.content, 16, true) + notice(dialog.typeName === "memory" ? "包含当前记忆库的完整记录与 USER.md。请输入宿主可写的 VFS 路径。" : "内容来自所选格式的真实导出接口。请输入宿主可写的 VFS 路径。"), footer: button("close-dialog", "取消", "") + button("save-export", "导出", "", "", "filled") };
}
