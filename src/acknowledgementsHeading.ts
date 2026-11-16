// The acknowledgements heading, shared by the program and the booklet maker,
// which finds the acknowledgements page by this heading.

export const noEnsembleAcknowledgementsHeading = 'Thank You for Your Generous Donations'
export const ensembleAcknowledgementsPrefix = 'Donors to'

export function acknowledgementsHeading(ensembleName: string) {
  const ensemble = ensembleName.trim()
  return ensemble ? `${ensembleAcknowledgementsPrefix} ${ensemble}` : noEnsembleAcknowledgementsHeading
}

// Whether a line of text read from a PDF starts the heading, ignoring spaces,
// which PDF text often loses or adds. A long ensemble name can wrap the
// heading, so only the start of its first line is matched. Older PDFs used
// the heading "Acknowledgements".
export function isAcknowledgementsHeadingLine(text: string) {
  const squeezed = text.replace(/\s/g, '')
  const squeeze = (heading: string) => heading.replace(/\s/g, '')
  return (
    squeezed === squeeze(noEnsembleAcknowledgementsHeading) ||
    squeezed.startsWith(squeeze(ensembleAcknowledgementsPrefix)) ||
    squeezed === 'Acknowledgements'
  )
}
