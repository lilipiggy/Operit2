import PlanaskScreen from "../ui/planask/index.ui.js";
import { PLANASK_XML_TAG } from "../shared/plan_mode_constants.js";

/** Renders complete or streaming planask content with the Compose DSL. */
export function onPlanaskXmlRender(
  event: ToolPkg.XmlRenderHookEvent
): ToolPkg.XmlRenderHookObjectResult {
  const payload = event.eventPayload;
  const tagName = payload.tagName;
  if (tagName !== PLANASK_XML_TAG) {
    return { handled: false };
  }
  const xmlContent = payload.xmlContent;
  if (xmlContent === undefined) {
    return { handled: false };
  }
  return {
    handled: true,
    composeDsl: {
      screen: PlanaskScreen,
      state: {
        xmlContent,
        chatId: payload.chatId ?? null,
      },
      memo: {},
    },
  };
}
