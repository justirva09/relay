// Rename the script API without changing string literals, comments, regular
// expressions, or the text portions of template literals. Postman collection
// imports use pm -> relay; Postman exports reverse that conversion.
export function rewriteScriptNamespace(source: string, from: string, to: string): string {
  let result = "";
  let index = 0;
  let state: "code" | "single" | "double" | "template" | "line" | "block" | "regex" = "code";
  const templateDepths: number[] = [];
  let regexClass = false;
  let previousToken = "";

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") {
      result += char;
      index++;
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      result += char;
      index++;
      if (char === "*" && next === "/") { result += next; index++; state = "code"; }
      continue;
    }
    if (state === "single" || state === "double" || state === "template" || state === "regex") {
      if (char === "\\") {
        result += source.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (state === "template" && char === "$" && next === "{") {
        result += "${";
        index += 2;
        templateDepths.push(0);
        state = "code";
        previousToken = "{";
        continue;
      }
      result += char;
      index++;
      if ((state === "single" && char === "'") || (state === "double" && char === '"') || (state === "template" && char === "`")) {
        state = "code";
        previousToken = "value";
      } else if (state === "regex") {
        if (char === "[") regexClass = true;
        if (char === "]") regexClass = false;
        if (char === "/" && !regexClass) { state = "code"; previousToken = "value"; }
      }
      continue;
    }

    if (char === "/" && next === "/") { result += "//"; index += 2; state = "line"; continue; }
    if (char === "/" && next === "*") { result += "/*"; index += 2; state = "block"; continue; }
    if (char === "'" || char === '"' || char === "`") {
      result += char;
      index++;
      state = char === "'" ? "single" : char === '"' ? "double" : "template";
      continue;
    }
    if (char === "/" && (/[=([{,:;!?]/.test(previousToken) || /^(return|throw|case|yield|await)$/.test(previousToken) || !previousToken)) {
      result += char;
      index++;
      state = "regex";
      regexClass = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index++;
      while (index < source.length && /[\w$]/.test(source[index])) index++;
      const word = source.slice(start, index);
      const before = previousToken.slice(-1);
      const after = source.slice(index).trimStart().slice(0, 1);
      const isRoot = before !== "." && before !== "?" && after !== ":";
      result += word === from && isRoot ? to : word;
      previousToken = word;
      continue;
    }
    if (templateDepths.length && char === "}") {
      const depth = templateDepths.length - 1;
      if (templateDepths[depth] === 0) {
        templateDepths.pop();
        result += char;
        index++;
        state = "template";
        continue;
      }
      templateDepths[depth]--;
    } else if (templateDepths.length && char === "{") {
      templateDepths[templateDepths.length - 1]++;
    }
    result += char;
    index++;
    if (!/\s/.test(char)) previousToken = char;
  }
  return result;
}
