import * as pdfjsLib from "../vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../vendor/pdfjs/pdf.worker.mjs",
  import.meta.url,
).href;

const CMAP_URL = new URL("../vendor/pdfjs/cmaps/", import.meta.url).href;
const STANDARD_FONT_URL = new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href;

function pageText(items) {
  return items
    .filter((item) => typeof item.str === "string")
    .map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`)
    .join("")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfText(file, { maxChars = 20000, maxPages = 200 } = {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    useSystemFonts: true,
    useWasm: false,
    verbosity: 0,
  });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > maxPages) {
      throw new Error(`This PDF has ${pdf.numPages} pages. The limit is ${maxPages} pages.`);
    }

    const pages = [];
    let length = 0;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (length >= maxChars) {
        truncated = true;
        break;
      }
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const text = pageText(content.items);
      const remaining = maxChars - length;
      if (text.length > remaining) {
        pages.push(text.slice(0, remaining));
        length += remaining;
        truncated = true;
        break;
      }
      if (text) {
        pages.push(text);
        length += text.length;
      }
    }

    return { text: pages.join("\n\n"), pages: pdf.numPages, truncated };
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Remove its password and attach it again.");
    }
    if (error instanceof Error && error.message.startsWith("This PDF has ")) throw error;
    throw new Error("This PDF could not be read. Check that it is a valid, unprotected PDF.");
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
