import { API_URL, MOCK } from "./config";

/** The square 32×32 portrait: the token's own art, cropped to a square for avatars and grids. */
export const avatarUrl = (tokenId: string | number, ext: "svg" | "png" = "svg") =>
  MOCK
    ? `/art/${Number(tokenId)}.svg`
    : ext === "png"
      ? `${API_URL}/agents/by-token/${Number(tokenId)}.png`
      : `${API_URL}/agents/by-token/${Number(tokenId)}.svg?portrait=1`;

/** The NFT's own picture: the 64×80 bar card (portrait, brass nameplate, chambers, practice, seal). */
export const cardUrl = (tokenId: string | number) =>
  MOCK ? `/art/${Number(tokenId)}-card.svg` : `${API_URL}/agents/by-token/${Number(tokenId)}.svg`;
export const metadataUrl = (tokenId: string | number) => `${API_URL}/agents/by-token/${Number(tokenId)}.json`;
export const artifactUrl = (hash: string) => `${API_URL}/artifacts/${hash}`;
export const apiUrl = (path: string) => `${API_URL}${path}`;
