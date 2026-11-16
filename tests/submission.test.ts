/** Paste Images: attaching images to each kind of submission. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachImages, fitSize, splitDataUrl } from "../src/submission.ts";
import type { ImageBlock } from "../src/submission.ts";

const image: ImageBlock = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" };
const content = (text: string) => ({ text, images: [] });

test("message text and practice thinking carry the images after existing ones", () => {
  const existing: ImageBlock = { type: "image", data: "AAAA", mimeType: "image/jpeg" };
  const result = attachImages({ type: "text", content: { text: "look", images: [existing] } }, [image], ["content"]);
  assert.deepEqual(result, { type: "text", content: { text: "look", images: [existing, image] } });
  assert.deepEqual(attachImages({ type: "thinking", content: content("") }, [image], ["content"]), { type: "thinking", content: { text: "", images: [image] } });
});

test("answers carry the images in their thinking, only when that channel applies", () => {
  const answer = { type: "answer" as const, answer: { images: [] }, thinking: content("why"), readingThinking: content("") };
  const result = attachImages(answer, [image], ["answer", "thinking"]);
  assert.deepEqual(result && "thinking" in result ? result.thinking : null, { text: "why", images: [image] });
  assert.equal(attachImages(answer, [image], ["answer"]), null, "no thinking field: leave the answer alone");
  assert.equal(attachImages({ type: "text", content: content("x") }, [], ["content"]), null);
});

test("sizes shrink proportionally and never grow; data URLs split safely", () => {
  assert.deepEqual(fitSize(4000, 1000, 2000), { width: 2000, height: 500 });
  assert.deepEqual(fitSize(800, 600, 2000), { width: 800, height: 600 });
  assert.deepEqual(splitDataUrl("data:image/png;base64,iVBORw0KGgo="), { mimeType: "image/png", data: "iVBORw0KGgo=" });
  assert.equal(splitDataUrl("data:text/html,<b>x</b>"), null);
});
