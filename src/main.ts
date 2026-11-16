/** Paste Images — paste (Ctrl+V) or drop screenshots into any session field and
 * send them to the model with the message.
 *
 * Images wait in a small tray above the field they were pasted into. On send, a
 * submission interceptor attaches them to the message (or to an answer's
 * thinking); they are cleared only once the host confirms the submission was
 * accepted, so a failed send keeps them.
 */
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { MAX_IMAGES, MIME_TYPES, attachImages, fitSize, splitDataUrl } from "./submission.ts";
import type { ImageBlock } from "./submission.ts";

const MAX_SIDE = 2000;
const MAX_BYTES = 3_500_000;

interface Pending {
  readonly id: string;
  readonly image: ImageBlock;
  readonly preview: string;
}

const ru = (globalThis.navigator?.language ?? "en").toLowerCase().startsWith("ru");
const text = {
  remove: ru ? "Убрать" : "Remove",
  clear: ru ? "Убрать все" : "Remove all",
  count: (n: number) => (ru ? `Изображений к отправке: ${n}` : `${n} image${n === 1 ? "" : "s"} will be sent`),
  limit: ru ? `Можно приложить не больше ${MAX_IMAGES} изображений` : `At most ${MAX_IMAGES} images per message`,
  failed: ru ? "Не удалось прочитать изображение" : "Could not read the image",
};

/** Session pages are /chat/<id> (and /chat/new before the first message). */
const sessionKey = (): string | null => {
  const path = globalThis.location?.pathname ?? "";
  return /^\/chat\//.test(path) ? path : null;
};

function isTextField(target: EventTarget | null): target is HTMLElement {
  if (!target || !(target instanceof HTMLElement)) return false;
  return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === "text") || target.isContentEditable;
}

async function toImage(file: Blob): Promise<ImageBlock> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
  const original = splitDataUrl(dataUrl);
  const bitmap = await createImageBitmap(file).catch(() => null);
  const small = bitmap ? Math.max(bitmap.width, bitmap.height) <= MAX_SIDE : true;
  if (original && (MIME_TYPES as readonly string[]).includes(original.mimeType) && small && file.size <= MAX_BYTES) {
    bitmap?.close();
    return { type: "image", data: original.data, mimeType: original.mimeType };
  }
  if (!bitmap) throw new Error(text.failed);
  // Large screenshots are scaled down so they stay within model image limits.
  const size = fitSize(bitmap.width, bitmap.height, MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  let encoded = splitDataUrl(canvas.toDataURL("image/png"));
  if (!encoded || encoded.data.length * 0.75 > MAX_BYTES) encoded = splitDataUrl(canvas.toDataURL("image/jpeg", 0.88));
  if (!encoded) throw new Error(text.failed);
  return { type: "image", data: encoded.data, mimeType: encoded.mimeType };
}

export function activate(ctx: PluginFrontendContext): () => void {
  const controller = new AbortController();
  const signal = controller.signal;
  const pending = new Map<string, Pending[]>();
  let anchor: HTMLElement | null = null;
  let counter = 0;
  let notice: string | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  function say(message: string): void {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = null;
      render();
    }, 4000);
    render();
  }

  const tray = document.createElement("div");
  tray.className = "pi-tray";
  tray.hidden = true;
  tray.setAttribute("role", "region");
  tray.setAttribute("aria-live", "polite");
  document.body.append(tray);

  const list = (): Pending[] => {
    const key = sessionKey();
    return key ? (pending.get(key) ?? []) : [];
  };

  function place(): void {
    if (tray.hidden) return;
    const field = anchor?.isConnected ? anchor : null;
    const rect = field?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      tray.style.left = "50%";
      tray.style.transform = "translateX(-50%)";
      tray.style.bottom = "96px";
      tray.style.top = "";
      return;
    }
    tray.style.transform = "";
    tray.style.left = `${Math.max(8, rect.left)}px`;
    tray.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
    tray.style.top = "";
  }

  function render(): void {
    const items = list();
    tray.hidden = items.length === 0 && notice === null;
    tray.replaceChildren();
    if (notice) {
      const line = document.createElement("div");
      line.className = "pi-notice";
      line.textContent = notice;
      tray.append(line);
    }
    if (items.length === 0) {
      place();
      return;
    }
    const row = document.createElement("div");
    row.className = "pi-row";
    for (const item of items) {
      const chip = document.createElement("div");
      chip.className = "pi-chip";
      const img = document.createElement("img");
      img.src = item.preview;
      img.alt = "";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pi-remove";
      remove.textContent = "×";
      remove.title = text.remove;
      remove.setAttribute("aria-label", text.remove);
      remove.addEventListener("click", () => drop(item.id), { signal });
      chip.append(img, remove);
      row.append(chip);
    }
    const footer = document.createElement("div");
    footer.className = "pi-footer";
    const label = document.createElement("span");
    label.textContent = text.count(items.length);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "pi-clear";
    clear.textContent = text.clear;
    clear.addEventListener("click", () => {
      const key = sessionKey();
      if (key) pending.delete(key);
      changed();
    }, { signal });
    footer.append(label, clear);
    tray.append(row, footer);
    place();
  }

  function changed(): void {
    render();
    ctx.refreshSubmissions();
  }

  function drop(id: string): void {
    const key = sessionKey();
    if (!key) return;
    pending.set(key, (pending.get(key) ?? []).filter((item) => item.id !== id));
    changed();
  }

  async function add(files: Blob[], field: HTMLElement): Promise<void> {
    const key = sessionKey();
    if (!key || files.length === 0) return;
    anchor = field;
    for (const file of files) {
      const current = pending.get(key) ?? [];
      if (current.length >= MAX_IMAGES) {
        say(text.limit);
        break;
      }
      try {
        const image = await toImage(file);
        if (signal.aborted) return;
        counter += 1;
        pending.set(key, [...(pending.get(key) ?? []), { id: `img-${counter}`, image, preview: `data:${image.mimeType};base64,${image.data}` }]);
        changed();
      } catch {
        say(text.failed);
      }
    }
  }

  const imagesIn = (data: DataTransfer | null): File[] =>
    data ? [...data.files].filter((file) => file.type.startsWith("image/")) : [];

  document.addEventListener(
    "paste",
    (event) => {
      if (!sessionKey() || !isTextField(event.target)) return;
      const files = imagesIn(event.clipboardData);
      if (files.length === 0) return;
      // Text copied together with an image (e.g. from a document) still pastes as text.
      if (!event.clipboardData?.getData("text/plain")) event.preventDefault();
      void add(files, event.target);
    },
    { signal, capture: true },
  );
  document.addEventListener(
    "dragover",
    (event) => {
      if (sessionKey() && isTextField(event.target) && [...(event.dataTransfer?.items ?? [])].some((item) => item.type.startsWith("image/"))) {
        event.preventDefault();
      }
    },
    { signal, capture: true },
  );
  document.addEventListener(
    "drop",
    (event) => {
      if (!sessionKey() || !isTextField(event.target)) return;
      const files = imagesIn(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      void add(files, event.target);
    },
    { signal, capture: true },
  );
  window.addEventListener("resize", place, { signal });
  window.addEventListener("scroll", place, { signal, capture: true });
  // Client-side navigation: show the tray of the page now open.
  let lastPath = globalThis.location?.pathname ?? "";
  const watch = setInterval(() => {
    const path = globalThis.location?.pathname ?? "";
    if (path !== lastPath) {
      lastPath = path;
      anchor = null;
      changed();
    }
  }, 500);

  const disposeInterceptor = ctx.registerSubmissionInterceptor({
    id: "paste-images",
    hasPendingInput: () => list().length > 0,
    intercept(input, context) {
      const key = sessionKey();
      const items = list();
      if (!key || items.length === 0) return undefined;
      const result = attachImages(input, items.map((item) => item.image), context.channels);
      if (!result) return undefined;
      const sent = new Set(items.map((item) => item.id));
      context.onAccepted(() => {
        pending.set(key, (pending.get(key) ?? []).filter((item) => !sent.has(item.id)));
        changed();
      });
      return result;
    },
  });

  return () => {
    controller.abort();
    clearInterval(watch);
    if (noticeTimer) clearTimeout(noticeTimer);
    disposeInterceptor();
    tray.remove();
  };
}
