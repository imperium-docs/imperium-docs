export function canonicalizeUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    let result = url.toString();
    // Remove trailing slash
    if (result.endsWith("/")) {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return input;
  }
}
