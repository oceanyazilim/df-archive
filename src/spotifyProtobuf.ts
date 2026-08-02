/**
 * Minimal protobuf reader for the Spotify client's track metadata response.
 *
 * `spclient.wg.spotify.com/metadata/4/track/{gid}` always answers protobuf
 * (content-type `vnd.spotify/metadata-track`) regardless of the Accept header,
 * so the response is decoded from the wire format rather than parsed as JSON.
 *
 * Field map, established from live responses:
 *   1  track gid (16 bytes)      2  name
 *   3  album { 1 gid, 2 name, 17 cover_group { 1 image { 1 file_id, 3 width } }, 25 licensor { 1 uuid } }
 *   4  artist { 1 gid, 2 name }  7  duration_ms
 *   10 external_id { 1 type, 2 id }
 *   21 licensor { 1 uuid }       24 original_audio { 1 uuid }
 *
 * SECURITY: the licensor UUID is read ONLY from field 21 (track level) with
 * album 3.25 as fallback. It is never taken from original_audio (24), any gid,
 * or the ISRC.
 */

export type DecodedTrack = {
  trackGid: string | null;
  trackTitle: string;
  artists: string[];
  albumTitle: string | null;
  isrc: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  licensorUuid: string | null;
};

type Field = number | Uint8Array | null;
type Message = Record<number, Field[]>;

function readVarint(b: Uint8Array, i: number): [number, number] {
  let r = 0, shift = 0, pos = i;
  while (pos < b.length) {
    const byte = b[pos++];
    r += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [r, pos];
}

/** Decode one protobuf message into { fieldNumber: [values] }. Never throws. */
export function decodeMessage(b: Uint8Array): Message {
  const out: Message = {};
  let i = 0;
  while (i < b.length) {
    const start = i;
    let key: number;
    [key, i] = readVarint(b, i);
    const field = key >>> 3, wire = key & 7;
    if (!field) break;
    let value: Field;
    if (wire === 0) { [value, i] = readVarint(b, i); }
    else if (wire === 2) {
      let len: number;
      [len, i] = readVarint(b, i);
      if (i + len > b.length) break;
      value = b.subarray(i, i + len);
      i += len;
    } else if (wire === 5) { value = null; i += 4; }
    else if (wire === 1) { value = null; i += 8; }
    else break;
    (out[field] ||= []).push(value);
    if (i <= start) break;
  }
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");
const bytesAt = (m: Message | null, f: number): Uint8Array | null => {
  const v = m?.[f]?.[0];
  return v instanceof Uint8Array ? v : null;
};
const subMessage = (m: Message | null, f: number): Message | null => {
  const b = bytesAt(m, f);
  return b ? decodeMessage(b) : null;
};

/** True when the message looks like a real track (16-byte gid in field 1). */
export function isTrackMessage(m: Message): boolean {
  const gid = bytesAt(m, 1);
  return !!gid && gid.length === 16;
}

/** Track-level licensor UUID, album-level fallback. Nothing else, ever. */
export function extractLicensorUuid(track: Message): string | null {
  const pick = (m: Message | null): string | null => {
    const u = bytesAt(m, 1);
    return u && u.length === 16 ? hex(u) : null;
  };
  return pick(subMessage(track, 21)) ?? pick(subMessage(subMessage(track, 3), 25));
}

/** Decode the full display model from raw protobuf bytes, or null if invalid. */
export function decodeTrackMetadata(bytes: Uint8Array): DecodedTrack | null {
  if (bytes.length < 8) return null;
  const track = decodeMessage(bytes);
  if (!isTrackMessage(track)) return null;

  const album = subMessage(track, 3);

  let isrc: string | null = null;
  for (const raw of track[10] ?? []) {
    if (!(raw instanceof Uint8Array)) continue;
    const e = decodeMessage(raw);
    const type = bytesAt(e, 1);
    const id = bytesAt(e, 2);
    if (type && id && utf8(type).toLowerCase() === "isrc") { isrc = utf8(id); break; }
  }

  const artists: string[] = [];
  for (const raw of track[4] ?? []) {
    if (!(raw instanceof Uint8Array)) continue;
    const name = bytesAt(decodeMessage(raw), 2);
    if (name) artists.push(utf8(name));
  }

  // Largest cover image in album.cover_group.image[].
  let artworkUrl: string | null = null;
  const group = subMessage(album, 17);
  if (group) {
    let best: Uint8Array | null = null, bestW = -1;
    for (const raw of group[1] ?? []) {
      if (!(raw instanceof Uint8Array)) continue;
      const img = decodeMessage(raw);
      const fileId = bytesAt(img, 1);
      const w = typeof img[3]?.[0] === "number" ? (img[3][0] as number) : 0;
      if (fileId && w > bestW) { best = fileId; bestW = w; }
    }
    if (best) artworkUrl = "https://i.scdn.co/image/" + hex(best);
  }

  const gid = bytesAt(track, 1);
  const title = bytesAt(track, 2);
  const albumName = bytesAt(album, 2);
  const duration = track[7]?.[0];

  return {
    trackGid: gid ? hex(gid) : null,
    trackTitle: title ? utf8(title) : "",
    artists,
    albumTitle: albumName ? utf8(albumName) : null,
    isrc,
    durationMs: typeof duration === "number" ? duration : null,
    artworkUrl,
    licensorUuid: extractLicensorUuid(track),
  };
}
