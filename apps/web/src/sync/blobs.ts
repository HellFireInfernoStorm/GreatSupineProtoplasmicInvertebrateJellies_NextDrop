import { MAX_BLOB_BYTES } from "@nextdrop/contracts";
import { uuidv7 } from "uuidv7";
import { fieldRepository } from "./repository";

/** Decode/resize before storing evidence; text never waits for evidence upload. */
export async function compressPhoto(source: Blob): Promise<Blob> {
  const image = await createImageBitmap(source);
  try {
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image compression unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.85, 0.7, 0.55, 0.4, 0.25]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= 200 * 1024) return blob;
    }
    // High-entropy images may miss the target at low quality; shrink further before storing.
    while (blob && blob.size > 200 * 1024 && Math.max(canvas.width, canvas.height) > 160) {
      canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.5));
    }
    if (!blob || blob.size > MAX_BLOB_BYTES) throw new Error("Image exceeds the upload limit");
    return blob;
  } finally {
    image.close();
  }
}

export async function queuePhoto(source: Blob, userId: string): Promise<string> {
  const bytes = await compressPhoto(source);
  const clientBlobId = uuidv7();
  await fieldRepository.db.blobQueue.add({
    clientBlobId,
    userId,
    bytes,
    state: "pending",
    attempts: 0,
    lastError: null,
  });
  fieldRepository.onWrite?.();
  return clientBlobId;
}
