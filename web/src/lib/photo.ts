/** Shrink a camera photo before upload: plenty for AI to read, much faster on cellular. */
export async function preparePhoto(file: File, max = 2000): Promise<{ b64: string; preview: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", 0.85);
  return { b64: preview.split(",")[1], preview };
}
