// A picture of a PDF's first page, for the composer, the panel and the cards.
// pdf.js is large, so it loads only when the first PDF needs a preview.

// Wide enough to stay sharp in the panel on a high-density screen.
const WIDTH = 320

/** An object URL of the first page as an image, or null if it can't be drawn. */
export async function pdfPreview(file: Blob): Promise<string | null> {
  try {
    const [pdfjs, { default: workerUrl }] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    try {
      const pdf = await task.promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: WIDTH / page.getViewport({ scale: 1 }).width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      const image = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 0.85))
      return image ? URL.createObjectURL(image) : null
    } finally {
      void task.destroy() // frees the worker's copy of the file
    }
  } catch {
    return null // a damaged or locked PDF keeps its name instead
  }
}
