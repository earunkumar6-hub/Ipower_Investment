// Upload rules shared by the attachments panel (browser) and uploadAttachment (server).

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Aadhaar / PAN card copies must be a JPG of 50 KB or smaller (owner, 26 Oct 2026). The panel shrinks a bigger
// photo in the browser before upload; the server refuses anything else.
export const ID_COPY_MAX_BYTES = 50 * 1024;
export const ID_COPY_RULE = "Aadhaar / PAN copy must be a JPG photo of 50 KB or smaller";
export const isIdCopy = (kind: string) => ["aadhaar", "pan"].includes(kind.trim().toLowerCase());
export const isSmallJpeg = (file: File) => file.type === "image/jpeg" && /\.jpe?g$/i.test(file.name) && file.size <= ID_COPY_MAX_BYTES;
