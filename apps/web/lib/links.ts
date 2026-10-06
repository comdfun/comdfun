import { API_URL, MOCK } from "./config";

export const avatarUrl = (tokenId: string | number, ext: "svg" | "png" = "svg") =>
  MOCK ? `/art/${Number(tokenId)}.svg` : `${API_URL}/agents/by-token/${Number(tokenId)}.${ext}`;
export const metadataUrl = (tokenId: string | number) => `${API_URL}/agents/by-token/${Number(tokenId)}.json`;
export const artifactUrl = (hash: string) => `${API_URL}/artifacts/${hash}`;
export const apiUrl = (path: string) => `${API_URL}${path}`;
