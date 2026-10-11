import { XML_TAG } from "./plan_mode_constants.js";

export type ParsedPlantodo = {
  raw: string;
  body: string;
  hasWrapper: boolean;
  closed: boolean;
};

/** Finds the first character after the opening plantodo tag. */
function findOpeningTagEnd(raw: string): number {
  const openTag = new RegExp(`<${XML_TAG}\\b[^>]*>`, "i");
  const match = raw.match(openTag);
  if (!match || typeof match.index !== "number") {
    return -1;
  }
  return match.index + match[0].length;
}

/** Parses a plantodo block and records whether streaming has completed. */
export function parsePlantodoXml(rawValue: string): ParsedPlantodo {
  const raw = rawValue.replace(/\r\n/g, "\n");
  const openTagRegex = new RegExp(`<${XML_TAG}\\b[^>]*>`, "i");
  const closeTagRegex = new RegExp(`</${XML_TAG}>`, "i");
  const hasWrapper = openTagRegex.test(raw);
  if (!hasWrapper) {
    return {
      raw,
      body: raw.trim(),
      hasWrapper: false,
      closed: false,
    };
  }

  const bodyStart = findOpeningTagEnd(raw);
  const closeMatch = raw.match(closeTagRegex);
  const closeIndex = closeMatch && typeof closeMatch.index === "number" ? closeMatch.index : -1;
  const closed = closeIndex >= 0 && closeIndex >= bodyStart;
  const body = raw.slice(bodyStart, closed ? closeIndex : raw.length).trim();
  return {
    raw,
    body,
    hasWrapper: true,
    closed,
  };
}

/** Splits non-empty plan Markdown lines for compact rendering. */
export function splitPlanBodyLines(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
