// Skynet: foliate-js's PDF backend is not vendored (it bundles 13 MB of
// pdf.js); PDFs open in Skynet's own PDF viewer instead.
export const makePDF = async () => {
  throw new Error("PDF files open in the PDF viewer")
}
