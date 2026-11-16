/** Pure helpers: attach pending images to a learner submission (no DOM). */
import type { PluginSubmission, PluginSubmissionChannel } from "learnharness-plugin-api";

export interface ImageBlock {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export const MAX_IMAGES = 6;
export const MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/**
 * Add `images` to the channel the learner actually wrote in: the message text,
 * practice thinking, or the "thinking" field of an answer. Returns null when the
 * submission has no channel that can carry images, so the caller leaves it alone.
 */
export function attachImages(
  input: PluginSubmission,
  images: readonly ImageBlock[],
  channels: readonly PluginSubmissionChannel[],
): PluginSubmission | null {
  if (images.length === 0) return null;
  switch (input.type) {
    case "text":
    case "thinking":
      return { ...input, content: { text: input.content.text, images: [...input.content.images, ...images] } };
    case "answer":
    case "plugin-question-answer":
    case "plugin-problem-submission":
      if (!channels.includes("thinking")) return null;
      return { ...input, thinking: { text: input.thinking.text, images: [...input.thinking.images, ...images] } };
    default:
      return null;
  }
}

/** Fit inside `maxSide` keeping proportions; never upscale. */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** base64 payload of a `data:` URL, with its mime type. */
export function splitDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(url);
  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}
