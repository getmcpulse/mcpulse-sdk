/**
 * Did this call succeed while returning nothing useful?
 *
 * This is the metric that catches the failures nobody reports: a search that
 * finds no rows, a lookup that misses, a query that comes back `[]`. The
 * protocol calls all of those success, the model gets nothing it can use, and
 * the author never hears about it.
 *
 * Only ever asked of a call that already succeeded — an error has its own
 * outcome and is not also "empty".
 */
export function is_empty_result(result: unknown): boolean {
  if (result === null || result === undefined) return true;

  const value = result as { content?: unknown; structuredContent?: unknown };

  // Structured output is the answer when a tool provides one, so it decides.
  if (value.structuredContent !== undefined) return is_hollow(value.structuredContent);

  if (Array.isArray(value.content)) return is_empty_content(value.content);

  // Not a tool result shape at all — judge the thing itself.
  return is_hollow(result);
}

/**
 * MCP returns content as a list of parts. No parts is empty. One text part is
 * the common case, and it is empty when the text is blank or when the text is
 * itself a serialised empty collection — `"[]"` is the single most common way
 * a tool says "nothing found" while reporting success.
 */
function is_empty_content(content: unknown[]): boolean {
  if (content.length === 0) return true;
  if (content.length > 1) return false;

  const part = content[0] as { type?: unknown; text?: unknown };
  if (part?.type !== "text" || typeof part.text !== "string") return false;

  const text = part.text.trim();
  if (text === "") return true;

  try {
    return is_hollow(JSON.parse(text));
  } catch {
    // Prose, not JSON. A tool that answers in a sentence has said something.
    return false;
  }
}

/** Empty array, empty object, empty string, or nothing at all. */
function is_hollow(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;

  // A number or a boolean is an answer. `0` and `false` are results, not
  // absences, and counting them as empty would report working tools as broken.
  return false;
}
