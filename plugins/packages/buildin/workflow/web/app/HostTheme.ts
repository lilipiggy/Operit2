import { useEffect, useState } from "react";
import type { ComposeThemeSnapshot } from "../../../../../types/compose-dsl";

declare global {
  interface Window {
    workflowTheme?: ComposeThemeSnapshot;
    applyWorkflowTheme(theme: ComposeThemeSnapshot): void;
  }
}

/** Accepts theme data sent explicitly by this plugin's WebView controller. */
window.applyWorkflowTheme = (theme) => {
  window.workflowTheme = theme;
  window.dispatchEvent(new Event("workflowThemeChanged"));
};

/** Observes the workflow plugin's own page theme without a host-injected channel. */
export function useHostTheme() {
  const [theme, setTheme] = useState<ComposeThemeSnapshot | undefined>(window.workflowTheme);
  useEffect(() => {
    /** Applies a host theme update while retaining the editor state. */
    function update() {
      setTheme(window.workflowTheme);
    }
    window.addEventListener("workflowThemeChanged", update);
    update();
    return () => window.removeEventListener("workflowThemeChanged", update);
  }, []);
  return theme;
}
