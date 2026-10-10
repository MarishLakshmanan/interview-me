import { transcriptToText, type TranscriptEntry } from "./session/transcript";

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
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Save the interview transcript as a plain-text file.
 *
 * @param lines The transcript lines.
 */
export function downloadTranscript(lines: TranscriptEntry[]): void {
  downloadText("interview-transcript.txt", transcriptToText(lines), "text/plain");
}
