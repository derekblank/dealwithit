import "jimp/browser/lib/jimp.js";
import type { Jimp } from "@jimp/core";
import type { Blit } from "@jimp/plugin-blit";
import type { ResizeClass } from "@jimp/plugin-resize";
import { BitmapImage, GifFrame, GifCodec, GifUtil } from "gifwrap";

import { prepareReportProgress } from "./utils.ts";

const { Jimp } = self;

let glassesImage: Jimp & ResizeClass & Blit;

function getProcessedImage(
  image: Jimp & ResizeClass & Blit,
  size: number,
  imageOptions: ImageOptions,
) {
  const isImageLong = image.bitmap.width >= image.bitmap.height;
  const width = isImageLong ? size : Jimp.AUTO;
  const height = isImageLong ? Jimp.AUTO : size;

  const processedImage = image
    .clone()
    .resize(width, height, Jimp.RESIZE_BICUBIC);

  if (imageOptions.flipHorizontally || imageOptions.flipVertically) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (processedImage as any).flip(
      imageOptions.flipHorizontally,
      imageOptions.flipVertically,
    );
  }

  return processedImage;
}

self.onmessage = (event: MessageEvent) => {
  const { configurationOptions, glasses, inputFile, inputImage, imageOptions } =
    event.data;
  const { looping, lastFrameDelay, frameDelay, numberOfFrames, size } =
    configurationOptions;
  const { glassesList, url: glassesImageUrl } = glasses;
  const { renderedWidth, renderedHeight } = inputImage;
  const reader = new FileReader();

  const reportProgress = prepareReportProgress(numberOfFrames);

  reader.onload = async () => {
    if (!glassesImage) {
      glassesImage = await Jimp.read(glassesImageUrl);
    }
    const originalImage = await Jimp.read(reader.result as Buffer);
    reportProgress();
    const image = getProcessedImage(originalImage, size, imageOptions);
    reportProgress();
    const { width, height } = image.bitmap;

    function getNumberOfLoops() {
      if (looping.mode === "infinite") {
        return 0;
      }

      return looping.loops;
    }

    function getLastFrameDelay() {
      if (looping.mode === "off") {
        // If you waited for a day, you deserve to see this workaround...
        // Since there is no way to not loop a gif using gifwrap,
        // let's just put a reeeeaaaaallly long delay after the last frame.
        return 8640000;
      }

      return Math.round(
        (lastFrameDelay.enabled && lastFrameDelay.value > 0
          ? lastFrameDelay.value
          : frameDelay) / 10,
      );
    }

    const frames = [];
    const scaledGlassesImage = glassesImage
      .clone()
      .resize(width / 2, Jimp.AUTO, Jimp.RESIZE_BICUBIC);
    reportProgress();
    const scaleX = width / renderedWidth;
    const scaleY = height / renderedHeight;
    for (let frameNumber = 0; frameNumber < numberOfFrames; ++frameNumber) {
      const jimpFrame = image.clone();
      for (const glassesInstance of glassesList) {
        const scaledX = scaleX * glassesInstance.coordinates.x;
        const scaledY = scaleY * glassesInstance.coordinates.y;
        const yMovementPerFrame = scaledY / numberOfFrames;
        jimpFrame.blit(
          scaledGlassesImage,
          scaledX,
          frameNumber * yMovementPerFrame,
        );
      }
      const jimpBitmap = new BitmapImage(jimpFrame.bitmap);
      GifUtil.quantizeDekker(jimpBitmap, 256);
      const frame = new GifFrame(jimpBitmap, {
        delayCentisecs: Math.round(frameDelay / 10),
      });
      frames.push(frame);
      reportProgress();
    }

    const jimpFrame = image.clone();
    for (const glassesInstance of glassesList) {
      const scaledX = scaleX * glassesInstance.coordinates.x;
      const scaledY = scaleY * glassesInstance.coordinates.y;
      const yMovementPerFrame = scaledY / numberOfFrames;
      jimpFrame.blit(
        scaledGlassesImage,
        scaledX,
        numberOfFrames * yMovementPerFrame,
      );
    }
    const jimpBitmap = new BitmapImage(jimpFrame.bitmap);
    GifUtil.quantizeDekker(jimpBitmap, 256);
    const frame = new GifFrame(jimpBitmap, {
      delayCentisecs: getLastFrameDelay(),
    });
    frames.push(frame);
    reportProgress();

    const codec = new GifCodec();
    const gif = await codec.encodeGif(frames, { loops: getNumberOfLoops() });
    const gifBlob = new File([gif.buffer], "", { type: "image/gif" });
    reportProgress();

    const fileReader = new FileReader();
    fileReader.onload = () => {
      self.postMessage({
        type: "OUTPUT",
        gifBlob,
        resultDataUrl: fileReader.result as string,
      });
    };
    fileReader.readAsDataURL(gifBlob);
  };
  reader.readAsArrayBuffer(inputFile);
};
