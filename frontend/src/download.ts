import { transcriptToText, type TranscriptEntry } from "./session/transcript";

/** How long the blob URL stays valid after the click, so every browser has time to start the download. */
const REVOKE_DELAY_MS = 10000;

/**
 * Save text as a file through the browser.
 *
 * @param filename The name the file is saved under.
 * @param text The file's contents.
 * @param type The media type, such as "text/plain" or "text/markdown".
 */
export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Firefox and Safari only start the download for a link that is in the document, and they need the
  // blob URL to stay valid until it has begun, so revoking is deferred.
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Save the interview transcript as a plain-text file.
 *
 * @param lines The transcript lines.
 */
export function downloadTranscript(lines: TranscriptEntry[]): void {
  downloadText("interview-transcript.txt", transcriptToText(lines), "text/plain");
}
