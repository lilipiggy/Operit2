import type {
  ComposeDslContext,
  ComposeNode,
  ComposeThemeSnapshot,
} from "../../../../../types/compose-dsl";
import type { Request } from "../service";
import type { Run, Snapshot } from "../model";

/** Embeds the bundled editor and exposes durable workflow operations through the shared host. */
export default function screen(ctx: ComposeDslContext): ComposeNode {
  const controller = ctx.createWebViewController("workflow-web");
  const [path, setPath] = ctx.useState("workflow-html-path", "");
  const [error, setError] = ctx.useState("workflow-html-error", "");
  const pageReady = ctx.useRef("workflow-page-ready", false);
  /** Applies the public Theme snapshot using this plugin's own page contract. */
  async function applyTheme(theme: ComposeThemeSnapshot): Promise<void> {
    if (!pageReady.current) return;
    await controller.evaluateJavascript(
      `window.applyWorkflowTheme(${JSON.stringify(theme)});`,
    );
  }
  /** Registers the service boundary before making the local document available. */
  async function initialize(): Promise<void> {
    try {
      ctx.Theme.subscribe(applyTheme);
      ToolPkg.ipc.on<Run, boolean>("workflow.progress", async progress => {
        if (pageReady.current) {
          await controller.evaluateJavascript(
            `window.receiveWorkflowProgress(${JSON.stringify(progress)});`,
          );
        }
        return true;
      });
      controller.addJavascriptInterface("WorkflowHost", {
        /** Marks the page ready and returns the current public theme snapshot. */
        currentTheme: () => {
          pageReady.current = true;
          return ctx.Theme.getCurrent();
        },
        /** Writes user-requested exports through the cross-platform file host. */
        exportFile: async (...args: unknown[]) => {
          const [path, content] = args[0] as [string, string];
          await Tools.Files.create(path, content);
        },
        /** Executes one persisted operation and returns its detached snapshot. */
        request: async (...args: unknown[]) => {
          const [request] = args[0] as [Request];
          return ToolPkg.ipc.call<Request, Snapshot>("workflow.web", request, {
            targetRuntime: "main",
          });
        },
      });
      setPath(await ToolPkg.readResource("workflow_web", "workflow.html"));
    } catch (failure) {
      setError(String(failure));
    }
  }
  return ctx.UI.Box(
    { fillMaxSize: true, onLoad: initialize },
    path === ""
      ? ctx.UI.Text({ text: error || "正在加载工作流…" })
      : ctx.UI.WebView({
          key: "workflow-web",
          controller,
          fillMaxSize: true,
          url: "https://workflow.operit.local/",
          javaScriptEnabled: true,
          domStorageEnabled: true,
          supportZoom: false,
          useWideViewPort: true,
          onShouldOverrideUrlLoading: (request) =>
            request.url === "https://workflow.operit.local/"
              ? { action: "allow" }
              : { action: "cancel" },
          onInterceptRequest: (request) =>
            request.url === "https://workflow.operit.local/"
              ? {
                  action: "respond",
                  response: {
                    mimeType: "text/html",
                    encoding: "utf-8",
                    statusCode: 200,
                    reasonPhrase: "OK",
                    filePath: path,
                  },
                }
              : { action: "block" },
        }),
  );
}
