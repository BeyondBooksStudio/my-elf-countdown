const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_DATA_URL_CHARS = 680_000;
const RASTER_FILE_EXTENSION = /\.(jpe?g|png|webp|avif|heic|heif|gif|bmp|tiff?)$/i;

export async function compressImage(file: File): Promise<string> {
  const mime = file.type.toLowerCase();
  const filename = file.name.toLowerCase();
  const isSvg = mime === "image/svg+xml" || filename.endsWith(".svg");
  const isRasterCandidate = mime.startsWith("image/") || RASTER_FILE_EXTENSION.test(filename);
  if (!isRasterCandidate || isSvg) {
    throw new Error("Choose a raster image such as JPG, PNG, WebP, AVIF, HEIC, or GIF. SVG files are not supported.");
  }
  if (file.size <= 0) throw new Error("That image file is empty.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Please choose an image under 25 MB.");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This browser could not open that image format. Try saving it as JPG or PNG, then upload it again."));
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("The selected image has no readable picture data.");
    if (image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error("That image has very large dimensions. Please choose a smaller copy.");
    }

    const ratio = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preview is unavailable in this browser.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.78, 0.68, 0.58, 0.48]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && dataUrl.length <= MAX_OUTPUT_DATA_URL_CHARS) return dataUrl;
    }
    throw new Error("That picture is still too large after compression. Try a smaller image.");
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
