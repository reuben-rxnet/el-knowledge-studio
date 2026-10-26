import "server-only";
import { BlobSASPermissions, generateBlobSASQueryParameters, SASProtocol, type StorageSharedKeyCredential, type UserDelegationKey } from "@azure/storage-blob";

/**
 * SAS URLs for direct browser uploads to Blob storage. Kept apart from storage.ts so the exact
 * permissions can be unit-tested: one blob, create and write only (no read, list or delete), 15 minutes.
 * Create alone ("c") would also stop the link overwriting the finished blob, but Put Block needs "w"
 * (refused with "c" alone, checked against the emulator). So the link can rewrite only its own blob,
 * only until it expires, and the app hands out no new link once the blob is committed.
 */
export const UPLOAD_SAS_MINUTES = 15;
export const UPLOAD_SAS_PERMISSIONS = "cw";

export type UploadSigner =
  | { kind: "account-key"; credential: StorageSharedKeyCredential }
  | { kind: "user-delegation"; key: UserDelegationKey; accountName: string };

/** Starts 5 minutes early (clock skew between the browser, the app and Azure), ends after 15 minutes. */
export function uploadSasWindow(now = new Date()) {
  return { startsOn: new Date(now.getTime() - 5 * 60_000), expiresOn: new Date(now.getTime() + UPLOAD_SAS_MINUTES * 60_000) };
}

export function signUploadUrl(blobUrl: string, containerName: string, blobName: string, window: { startsOn: Date; expiresOn: Date }, signer: UploadSigner): string {
  const values = {
    containerName, blobName,
    permissions: BlobSASPermissions.parse(UPLOAD_SAS_PERMISSIONS),
    startsOn: window.startsOn, expiresOn: window.expiresOn,
    // HTTPS only in Azure; the local emulator speaks plain HTTP.
    protocol: blobUrl.startsWith("https:") ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
  };
  const sas = signer.kind === "account-key"
    ? generateBlobSASQueryParameters(values, signer.credential)
    : generateBlobSASQueryParameters(values, signer.key, signer.accountName);
  return `${blobUrl}?${sas.toString()}`;
}
