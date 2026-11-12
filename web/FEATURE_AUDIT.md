# AI File Manager: implemented workflow and limits

## Order

Basic analysis runs first with basic_only=true and no Claude calls. It groups trusted complete-file/provider fingerprints, related document names/text and image similarity fingerprints. Sample and metadata hashes do not qualify as exact. One representative of each exact group remains available for comparison with different revisions.

Users then select up to 12 files, provide relevance/keep context and explicitly approve content processing. The second stage sends bounded image previews, PDF content/pages or document excerpts to Claude. It returns evidence, flags, keep/archive/delete candidates and editable filename suggestions. Reviewing never changes originals. Reviews are saved as account-owned recommendations; raw previews are not retained.

## Source and content coverage

Device originals remain in browser memory. Images are previewed up to 1280 pixels. Selected PDFs up to 2 MB/30 pages can be inspected visually; selected text and DOCX use up to 4,000 characters. The dashboard labels excerpt/preview coverage and unavailable content. Larger, encrypted or unsupported files may require manual review.

Drive/Dropbox connections can fetch eligible cloud image/PDF content or use extracted text. Scans refresh existing cloud records and preserve provider checksum provenance. Legacy uncertain fingerprints are excluded from exact matching until refreshed. Folder selection depends on browser support. OneDrive and Google Photos scans remain unavailable.

## Approved actions

Filename suggestions have editable fields and individual confirmation. Cloud rename failure retains old metadata; Dropbox paths update only after confirmed rename. Device approval downloads a renamed copy; it cannot change the original.

Cloud deletion candidates have individual confirmation. Drive files move to trash; Dropbox uses its provider delete API. Provider failures retain scan metadata. Archive candidates are recommendations for manual archival, not automatically translated into deletion. Device cleanup remains in the device file manager.

## Limits and verification

Claude needs a valid API key/model on Railway. Age, blur or similar naming do not establish irrelevance. The model is instructed to preserve unique/signed/final records and retain uncertain items. Live tests must confirm model availability; automated tests replace the model boundary and do not prove recommendation quality.

OAuth client IDs must be configured to use provider sign-in; an advanced validated access-token option is available. Reconnect currently creates a new saved connection, and disconnecting here does not revoke provider permissions. Google consent requests Drive access for explicitly approved rename/trash actions.

Browser hashing is limited to 128 MB per file; content uploads to 25 MB; content-review previews to 2 MB each and 8 MB combined. Backend listing currently returns up to 2,000 files. Real large-library pagination and server-side refresh/revoke lifecycle remain future work.
