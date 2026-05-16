/**
 * Read a browser File into a base64-encoded string with the `data:…;base64,`
 * prefix stripped. Suitable for sending to edge functions that expect a raw
 * base64 payload (e.g. scan-receipt).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result type."));
        return;
      }
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
