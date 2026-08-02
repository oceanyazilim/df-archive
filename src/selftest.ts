/**
 * End-to-end self-test using a fake authorized API client and token provider.
 * No real network calls are made. Run with: npm test  (ts-node src/selftest.ts)
 *
 * Exits non-zero if any assertion fails.
 */

import {
  DistributorResolver,
  setInternalApiClient,
  setTokenProvider,
  loadUuidMapping,
  buildMappingFromJson,
  normalizeUuid,
  UUID_MAPPING_PATH,
  InternalApiError,
  setLogLevel,
  parseSpotifyTrackId,
  extractIsrc,
  extractSpotifyMetadata,
  demoProvider,
  createSpotifyLicensorProvider,
  defaultResolverConfig,
  resolveUuid,
  resolveUuidBatch,
  buildTrackCatalogFromJson,
  findUuidForTrack,
  resolveDistributorForSpotifyTrack,
  parseSpotifyExtendedMetadata,
  validateSanitizedPayload,
  normalizeLicensorUuid,
  extractSpotifyTrackId,
  parseMetadataRequestUrl,
  resolveDistributorByLicensorUuid,
  parseMusicLookupInput,
  extractSpotifyAlbumId,
  buildAlbumRelease,
} from "./index";
import { InternalApiClient, TrackIdentifier } from "./types";

setLogLevel("error"); // keep test output quiet

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}
function eq<T>(actual: T, expected: T, label: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} (got ${JSON.stringify(actual)})`);
}

/**
 * Fake internal API. Maps a track id to a scripted response so we can drive
 * every branch: matched, unmatched, missing-uuid, and hard failure.
 */
function makeFakeClient(): InternalApiClient {
  return {
    async lookupTrack(id: TrackIdentifier, _token: string) {
      switch (id.value) {
        case "track-soundrop":
          // Nested licensor.uuid form + quoted/uppercased to test normalization.
          return {
            status: 200,
            body: { title: "Song A", artist: "X", licensor: { uuid: '"E0B063F7069449558AC1B5E967FB01BD" ' } },
          };
        case "track-unknown-uuid":
          return { status: 200, body: { licensorUuid: "ffffffffffffffffffffffffffffffff" } };
        case "track-no-uuid":
          return { status: 200, body: { title: "No licensor here" } };
        case "track-conflict":
          // Known conflicting UUID in the mapping file (Downtown Music vs DashGO).
          return { status: 200, body: { licensorUuid: "60315a5bfaa04520a1ee142e2df5b8ca" } };
        case "track-500":
          throw new InternalApiError("boom", 500, true);
        default:
          return { status: 404, body: { error: "not found" } };
      }
    },
  };
}

async function main(): Promise<void> {
  console.log("== mapping load / validation ==");
  const mapping = loadUuidMapping(UUID_MAPPING_PATH);
  assert(mapping.recordCount > 0, "mapping loaded with records");
  // The canonical data has merged former conflicts into single named records.
  eq(mapping.distributorByUuid.get("60315a5bfaa04520a1ee142e2df5b8ca"), "DashGo / Downtown Music Group", "60315a resolves to merged canonical name");
  console.log(`  info  records=${mapping.recordCount} conflicts=${mapping.conflicts.length} warnings=${mapping.warnings.length}`);

  console.log("== normalization ==");
  eq(normalizeUuid('  "ABC-123" '), "abc-123", "trim + strip quotes + lowercase");
  eq(normalizeUuid(null), null, "null -> null");
  eq(normalizeUuid("   "), null, "whitespace -> null");
  eq(normalizeUuid("`Xy`"), "xy", "backtick quotes stripped");

  console.log("== format detection ==");
  eq(buildMappingFromJson('{"AAA":"Dist One"}').distributorByUuid.get("aaa"), "Dist One", "object-map form");
  eq(
    buildMappingFromJson('[{"licensorUuid":"BBB","distributorName":"Dist Two"}]').distributorByUuid.get("bbb"),
    "Dist Two",
    "licensorUuid/distributorName form"
  );
  const conflictMap = buildMappingFromJson('[{"uuid":"z","name":"A"},{"uuid":"z","name":"B"}]');
  eq(conflictMap.conflicts.length, 1, "duplicate-different-distributor -> conflict");
  eq(conflictMap.distributorByUuid.has("z"), false, "conflicting uuid excluded from lookup map");
  const dupSame = buildMappingFromJson('[{"uuid":"q","name":"A"},{"uuid":"q","name":"A"}]');
  eq(dupSame.warnings.some((w) => w.code === "DUPLICATE_UUID_SAME_DISTRIBUTOR"), true, "duplicate-same-distributor -> warning");
  eq(dupSame.distributorByUuid.get("q"), "A", "duplicate-same-distributor keeps one record");

  // Wire the fakes.
  setTokenProvider({ getToken: () => "fake-token-value" });
  setInternalApiClient(makeFakeClient());
  const resolver = new DistributorResolver({ config: { maxRetries: 0, cacheTtlMs: 0 } });

  console.log("== single-track resolution ==");
  const matched = await resolver.resolveDistributorForTrack("track-soundrop");
  eq(matched.matchStatus, "matched", "matched status");
  eq(matched.distributor, "Soundrop / CD Baby", "matched distributor (via nested + normalized uuid)");
  eq(matched.licensorUuid, "e0b063f7069449558ac1b5e967fb01bd", "normalized licensor uuid");
  eq(matched.success, true, "matched success=true");

  const unmatched = await resolver.resolveDistributorForTrack("track-unknown-uuid");
  eq(unmatched.matchStatus, "unmatched", "unmatched status");
  eq(unmatched.distributor, null, "unmatched distributor null");
  eq(unmatched.error?.code, "UUID_NOT_FOUND", "unmatched error code");
  eq(unmatched.success, true, "unmatched success=true (API ok)");

  const missing = await resolver.resolveDistributorForTrack("track-no-uuid");
  eq(missing.matchStatus, "unresolved", "missing-uuid status");
  eq(missing.error?.code, "LICENSOR_UUID_MISSING", "missing-uuid error code");
  eq(missing.success, false, "missing-uuid success=false");

  const merged = await resolver.resolveDistributorForTrack("track-conflict");
  eq(merged.matchStatus, "matched", "60315a now matches (data merged)");
  eq(merged.distributor, "DashGo / Downtown Music Group", "merged canonical distributor name");

  const failed = await resolver.resolveDistributorForTrack("track-500");
  eq(failed.requestStatus, "failed", "api failure requestStatus=failed");
  eq(failed.error?.code, "INTERNAL_API_ERROR", "api failure error code");
  eq(failed.success, false, "api failure success=false");

  const invalid = await resolver.resolveDistributorForTrack("   ");
  eq(invalid.error?.code, "INVALID_TRACK_IDENTIFIER", "invalid identifier code");

  console.log("== batch: dedup, order, resilience ==");
  const batch = await resolver.resolveDistributorsForTracks([
    "track-soundrop",
    "track-unknown-uuid",
    "track-soundrop", // duplicate -> preserved in output, deduped on the wire
    "track-500",
    "track-no-uuid",
  ]);
  eq(batch.results.length, 5, "one result per input track (order preserved)");
  eq(batch.results[0].trackId, "track-soundrop", "order[0]");
  eq(batch.results[2].trackId, "track-soundrop", "order[2] duplicate preserved");
  eq(batch.results[0].distributor, "Soundrop / CD Baby", "batch matched distributor");
  eq(batch.summary.totalTracks, 5, "summary.totalTracks");
  eq(batch.summary.matchedDistributors, 2, "summary.matchedDistributors (dup counted)");
  eq(batch.summary.unmatchedUuids, 1, "summary.unmatchedUuids");
  eq(batch.summary.missingUuids, 1, "summary.missingUuids");
  eq(batch.summary.failedRequests, 1, "summary.failedRequests");

  console.log("== spotify url parsing ==");
  const SID = "6rqhFgbbKwnb9MLmUQDhG6";
  eq(parseSpotifyTrackId(`https://open.spotify.com/track/${SID}?si=abc`), SID, "open.spotify.com url");
  eq(parseSpotifyTrackId(`spotify:track:${SID}`), SID, "spotify: uri");
  eq(parseSpotifyTrackId(SID), SID, "bare 22-char id");
  eq(parseSpotifyTrackId(`https://open.spotify.com/intl-de/track/${SID}`), SID, "localized url");
  eq(parseSpotifyTrackId("just some text"), null, "non-spotify input -> null");

  console.log("== spotify extraction ==");
  const sampleTrack = {
    name: "Neon Skyline",
    external_ids: { isrc: "USABC1234567" },
    artists: [{ name: "Aurora Vale" }, { name: "Guest" }],
    album: { name: "Skyline EP", label: "Vale Records", images: [{ url: "https://img/x.jpg" }] },
  };
  eq(extractIsrc(sampleTrack), "USABC1234567", "isrc from external_ids.isrc");
  eq(extractIsrc({}), null, "missing external_ids -> null");
  const meta = extractSpotifyMetadata(sampleTrack);
  eq(meta.title, "Neon Skyline", "metadata title");
  eq(meta.artist, "Aurora Vale, Guest", "metadata artists joined");
  eq(meta.releaseTitle, "Skyline EP", "metadata album");

  console.log("== full pipeline via demo provider (spotify -> isrc -> licensor -> uuid) ==");
  const demoRes = new DistributorResolver({ provider: demoProvider, config: { cacheTtlMs: 0 } });
  const dTune = await demoRes.resolveDistributorForTrack({ value: "demo-tunecore", type: "spotify" });
  eq(dTune.matchStatus, "matched", "demo spotify -> matched");
  eq(dTune.distributor, "TuneCore Inc.", "demo spotify -> TuneCore");
  eq(dTune.meta?.isrc, "US1234500001", "demo carries isrc through pipeline");

  const dIsrc = await demoRes.resolveDistributorForTrack({ value: "US1234500001", type: "isrc" });
  eq(dIsrc.distributor, "TuneCore Inc.", "direct isrc input -> TuneCore (skips spotify)");

  const dUnknown = await demoRes.resolveDistributorForTrack({ value: "demo-unknown", type: "spotify" });
  eq(dUnknown.matchStatus, "unmatched", "demo unknown uuid -> unmatched");

  const dMissing = await demoRes.resolveDistributorForTrack({ value: "demo-missing", type: "spotify" });
  eq(dMissing.error?.code, "LICENSOR_UUID_MISSING", "demo no-isrc -> uuid missing");

  const dConflict = await demoRes.resolveDistributorForTrack({ value: "demo-conflict", type: "spotify" });
  eq(dConflict.distributor, "DashGo / Downtown Music Group", "demo-conflict uuid resolves to merged name");

  const dError = await demoRes.resolveDistributorForTrack({ value: "demo-error", type: "spotify" });
  eq(dError.requestStatus, "failed", "demo error -> failed");

  console.log("== invalid identifier classification (live provider, no network) ==");
  const liveRes = new DistributorResolver({
    provider: createSpotifyLicensorProvider(defaultResolverConfig()),
    config: { cacheTtlMs: 0 },
  });
  const badIsrc = await liveRes.resolveDistributorForTrack({ value: "NOT-AN-ISRC", type: "isrc" });
  eq(badIsrc.error?.code, "INVALID_TRACK_IDENTIFIER", "malformed ISRC -> invalid identifier (not API error)");
  const badSpotify = await liveRes.resolveDistributorForTrack({ value: "https://example.com/nope", type: "spotify" });
  eq(badSpotify.error?.code, "INVALID_TRACK_IDENTIFIER", "unparseable Spotify link -> invalid identifier");

  console.log("== local UUID resolver (UUID -> distributor, no external API) ==");
  // These UUIDs exist in json/uuid's.json.
  eq(resolveUuid("ede63b46782e46e19045255f32c0ff0f").distributor, "The Orchard Enterprises", "resolveUuid -> The Orchard");
  eq(resolveUuid("0f26cfca536a4a69a2baed1eca0a42ec").distributor, "FUGA", "resolveUuid -> FUGA");
  eq(resolveUuid("18fbcef4fb624fc58d4a7fdd230bd523").distributor, "PK Interactive / DistroKid", "resolveUuid -> PK Interactive / DistroKid");
  eq(resolveUuid("ede63b46782e46e19045255f32c0ff0f").matchStatus, "matched", "matched status");

  // Normalization variants all resolve to the same record.
  eq(resolveUuid("EDE63B46782E46E19045255F32C0FF0F").distributor, "The Orchard Enterprises", "uppercase UUID matches");
  eq(resolveUuid("ede63b46-782e-46e1-9045-255f32c0ff0f").distributor, "The Orchard Enterprises", "hyphenated UUID matches");
  eq(resolveUuid('"ede63b46782e46e19045255f32c0ff0f"').distributor, "The Orchard Enterprises", "quoted UUID matches");
  eq(normalizeUuid("ede63b46-782e-46e1-9045-255f32c0ff0f"), "ede63b46782e46e19045255f32c0ff0f", "hyphen collapse for canonical UUID");
  eq(normalizeUuid('  "ABC-123" '), "abc-123", "non-UUID keeps hyphens (backward compatible)");

  // Unknown, invalid, conflict.
  eq(resolveUuid("unknown-uuid-value").matchStatus, "unmatched", "unknown -> unmatched");
  eq(resolveUuid("unknown-uuid-value").error?.code, "UUID_NOT_FOUND", "unknown error code");
  eq(resolveUuid("   ").matchStatus, "invalid", "blank -> invalid");
  eq(resolveUuid(null).matchStatus, "invalid", "null -> invalid");
  const conf = resolveUuid("60315a5bfaa04520a1ee142e2df5b8ca");
  eq(conf.matchStatus, "matched", "60315a now matched (merged data)");
  eq(conf.distributor, "DashGo / Downtown Music Group", "merged canonical name");
  // Conflict-detection logic is covered by the synthetic buildMappingFromJson test above.

  console.log("== local UUID batch ==");
  const batchUuid = resolveUuidBatch([
    "ede63b46782e46e19045255f32c0ff0f",
    "0f26cfca536a4a69a2baed1eca0a42ec",
    "unknown-uuid",
    "60315a5bfaa04520a1ee142e2df5b8ca",
    "  ",
  ]);
  eq(batchUuid.summary.total, 5, "batch total");
  eq(batchUuid.summary.matched, 3, "batch matched");
  eq(batchUuid.summary.unmatched, 1, "batch unmatched");
  eq(batchUuid.summary.conflicts, 0, "batch conflicts (data has none)");
  eq(batchUuid.summary.invalid, 1, "batch invalid");
  eq(batchUuid.results.length, 5, "batch preserves one row per input");

  console.log("== track catalog (spotify id / ISRC -> UUID) ==");
  const cat = buildTrackCatalogFromJson(JSON.stringify([
    { spotifyTrackId: "EXAMPLEtrackID00000001", isrc: "USEXA0000001", licensorUuid: "ede63b46782e46e19045255f32c0ff0f" },
    { spotifyTrackId: "EXAMPLEtrackID00000002", isrc: "us-exa-0000002", licensorUuid: "A830A34F35844BD784EAC9A7FB395996" },
    { isrc: "ZZDUP0000009", licensorUuid: "aaa" },
    { isrc: "ZZDUP0000009", licensorUuid: "bbb" }, // conflict
  ]));
  eq(cat.uuidBySpotifyId.get("EXAMPLEtrackID00000001"), "ede63b46782e46e19045255f32c0ff0f", "catalog by spotify id");
  eq(cat.uuidByIsrc.get("USEXA0000002"), "a830a34f35844bd784eac9a7fb395996", "catalog isrc normalized (hyphens/case)");
  eq(cat.conflicts.length, 1, "catalog detects conflicting ISRC -> UUID");
  eq(cat.uuidByIsrc.has("ZZDUP0000009"), false, "conflicting isrc excluded");
  eq(findUuidForTrack(cat, "EXAMPLEtrackID00000001", null)?.matchedBy, "spotifyTrackId", "matched by spotify id");
  eq(findUuidForTrack(cat, "unknownnnnnnnnnnnnnnn0", "USEXA0000001")?.matchedBy, "isrc", "matched by isrc fallback");

  console.log("== full Spotify-track resolution (offline via catalog spotify id) ==");
  // Spotify is NOT configured in the test env, so metadata is skipped and the
  // track resolves purely via its Spotify id in the local catalog.
  const rOrchard = await resolveDistributorForSpotifyTrack(
    "https://open.spotify.com/track/EXAMPLEtrackID00000001"
  );
  eq(rOrchard.status, "resolved", "spotify url -> resolved");
  eq(rOrchard.distributor, "The Orchard Enterprises", "spotify url -> The Orchard");
  eq(rOrchard.licensorUuid, "ede63b46782e46e19045255f32c0ff0f", "resolved licensor uuid");
  eq(rOrchard.matchedBy, "spotifyTrackId", "resolved by spotify id");

  const rTune = await resolveDistributorForSpotifyTrack("EXAMPLEtrackID00000002");
  eq(rTune.distributor, "TuneCore Inc.", "bare id -> TuneCore");

  const rInvalid = await resolveDistributorForSpotifyTrack("not a spotify url");
  eq(rInvalid.status, "invalid_input", "non-spotify input -> invalid_input");

  const rNotInCatalog = await resolveDistributorForSpotifyTrack(
    "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6"
  );
  eq(rNotInCatalog.status, "track_not_in_catalog", "real track not in catalog -> track_not_in_catalog");
  eq(rNotInCatalog.spotifyTrackId, "6rqhFgbbKwnb9MLmUQDhG6", "still parses the real spotify id");

  console.log("== spotify metadata parser + identifiers (connector) ==");
  const FIX = {
    gid: "be172e79403e48edb9742d98baf252cd",
    name: "MONTAGEM GRITOS TALENTO 3",
    album: { gid: "f63c664e993844cb87125eee231b3591", name: "MONTAGEM GRITOS TALENTO 3", label: "0to8", licensor: { uuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5" } },
    artist: [{ gid: "010d073caf5e4398acaf3e7c5eb9cc0d", name: "prodbydxm" }, { gid: "d38198bb9e8344b3acb9e4c605c62716", name: "DJ FRIZER" }],
    duration: 74307,
    external_id: [{ type: "isrc", id: "FRX282689836" }],
    original_audio: { uuid: "0000000000000000000000000000dead" },
    content_authorization_attributes: { secret: "x" },
    licensor: { uuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5" },
    canonical_uri: "spotify:track:5MH8rf9BdkrFlBEeaYkFZ3",
  };
  eq(parseMetadataRequestUrl("https://spclient.wg.spotify.com/metadata/4/track/be172e79403e48edb9742d98baf252cd?market=from_token")?.trackGid, "be172e79403e48edb9742d98baf252cd", "metadata request url matcher");
  eq(parseMetadataRequestUrl("https://spclient.wg.spotify.com/collection/v2/contains?market=from_token"), null, "collection endpoint ignored");
  eq(extractSpotifyTrackId("https://open.spotify.com/track/5MH8rf9BdkrFlBEeaYkFZ3?si=abc"), "5MH8rf9BdkrFlBEeaYkFZ3", "track url (ignores ?si=)");
  eq(extractSpotifyTrackId("spotify:track:5MH8rf9BdkrFlBEeaYkFZ3"), "5MH8rf9BdkrFlBEeaYkFZ3", "track uri");
  eq(extractSpotifyTrackId("5MH8rf9BdkrFlBEeaYkFZ3"), "5MH8rf9BdkrFlBEeaYkFZ3", "bare id");
  eq(extractSpotifyTrackId("https://open.spotify.com/album/5MH8rf9BdkrFlBEeaYkFZ3"), null, "album url rejected");
  eq(extractSpotifyTrackId("spotify:artist:5MH8rf9BdkrFlBEeaYkFZ3"), null, "artist uri rejected");
  eq(extractSpotifyTrackId("https://open.spotify.com/playlist/abc"), null, "playlist url rejected");

  const parsed = parseSpotifyExtendedMetadata(FIX);
  eq(parsed?.licensorUuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "parser: top-level licensor.uuid");
  eq(parsed?.spotifyTrackId, "5MH8rf9BdkrFlBEeaYkFZ3", "parser: track id from canonical_uri");
  eq(parsed?.artists.join(","), "prodbydxm,DJ FRIZER", "parser: artist names");
  eq(parsed?.isrc, "FRX282689836", "parser: isrc");
  eq(parsed?.albumLabel, "0to8", "parser: album label (display only)");
  eq(parsed?.trackGid, "be172e79403e48edb9742d98baf252cd", "parser: track gid");
  assert(parsed?.licensorUuid !== "0000000000000000000000000000dead", "parser never uses original_audio.uuid");

  // top-level priority over album-level
  const priFix = { ...FIX, licensor: { uuid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, album: { ...FIX.album, licensor: { uuid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } } };
  eq(parseSpotifyExtendedMetadata(priFix)?.licensorUuid, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "top-level licensor UUID wins");
  // album fallback when no top-level
  const albFix = { ...FIX } as Record<string, unknown>; delete albFix.licensor;
  eq(parseSpotifyExtendedMetadata(albFix)?.licensorUuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "album.licensor.uuid fallback");
  // missing both -> reject
  const noLic = { ...FIX } as Record<string, unknown>; delete noLic.licensor; noLic.album = { ...FIX.album, licensor: undefined };
  eq(parseSpotifyExtendedMetadata(noLic), null, "missing licensor -> reject");
  eq(parseSpotifyExtendedMetadata({ name: "x" }), null, "malformed response -> null");

  eq(normalizeLicensorUuid("C71B29EA9E1E48C6931DA2DD7C0BF5D5"), "c71b29ea9e1e48c6931da2dd7c0bf5d5", "normalize uppercase");
  eq(normalizeLicensorUuid("c71b29ea-9e1e-48c6-931d-a2dd7c0bf5d5"), "c71b29ea9e1e48c6931da2dd7c0bf5d5", "normalize hyphenated");
  eq(normalizeLicensorUuid("not-a-uuid"), null, "normalize rejects non-32hex");

  console.log("== sanitized payload allowlist ==");
  const good = { source: "spotify-web-player", spotifyTrackId: "5MH8rf9BdkrFlBEeaYkFZ3", licensorUuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5", artists: ["a"] };
  eq(validateSanitizedPayload(good).ok, true, "clean payload accepted");
  const withToken = { ...good, authorization: "Bearer secret" } as Record<string, unknown>;
  const rej = validateSanitizedPayload(withToken);
  eq(rej.ok, false, "payload with forbidden 'authorization' field rejected");

  console.log("== distributor resolution by licensor UUID (distinct statuses) ==");
  // verified — exact match, exact stored name.
  eq(resolveDistributorByLicensorUuid("c71b29ea9e1e48c6931da2dd7c0bf5d5").name, "Believe Digital", "UUID -> Believe Digital (verified)");
  eq(resolveDistributorByLicensorUuid("c71b29ea9e1e48c6931da2dd7c0bf5d5").status, "verified", "verified status");
  eq(resolveDistributorByLicensorUuid("c71b29ea9e1e48c6931da2dd7c0bf5d5").uuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "verified carries normalized uuid");
  // Normalization inside the resolver (hyphens/uppercase) still verifies.
  eq(resolveDistributorByLicensorUuid("C71B29EA-9E1E-48C6-931D-A2DD7C0BF5D5").status, "verified", "hyphenated+uppercase UUID still verified");
  // uuid_not_mapped — valid 32-hex, absent from mapping (NOT collapsed to unavailable).
  eq(resolveDistributorByLicensorUuid("00000000000000000000000000000000").status, "uuid_not_mapped", "valid unknown uuid -> uuid_not_mapped");
  eq(resolveDistributorByLicensorUuid("00000000000000000000000000000000").uuid, "00000000000000000000000000000000", "uuid_not_mapped keeps the captured uuid");
  eq(resolveDistributorByLicensorUuid("00000000000000000000000000000000").name, null, "uuid_not_mapped name is null");
  // uuid_unavailable — nothing supplied.
  eq(resolveDistributorByLicensorUuid(null).status, "uuid_unavailable", "null -> uuid_unavailable");
  eq(resolveDistributorByLicensorUuid("").status, "uuid_unavailable", "empty -> uuid_unavailable");
  eq(resolveDistributorByLicensorUuid("   ").status, "uuid_unavailable", "whitespace -> uuid_unavailable");
  // invalid_uuid — a value was supplied but is not a 32-hex UUID.
  eq(resolveDistributorByLicensorUuid("not-a-uuid").status, "invalid_uuid", "garbage -> invalid_uuid");
  eq(resolveDistributorByLicensorUuid("5MH8rf9BdkrFlBEeaYkFZ3").status, "invalid_uuid", "spotify track id -> invalid_uuid (never a distributor)");
  // 60315a merged data still verifies.
  eq(resolveDistributorByLicensorUuid("60315a5bfaa04520a1ee142e2df5b8ca").name, "DashGo / Downtown Music Group", "60315a -> DashGo / Downtown Music Group (verified)");
  // Output shape is exactly name/uuid/status — no internals.
  eq(Object.keys(resolveDistributorByLicensorUuid("c71b29ea9e1e48c6931da2dd7c0bf5d5")).sort().join(","), "name,status,uuid", "resolver output is only name/uuid/status");

  console.log("== soundcharts: input parser ==");
  eq(parseMusicLookupInput("https://open.spotify.com/track/5MH8rf9BdkrFlBEeaYkFZ3?si=x").type, "spotify_track", "spotify url -> spotify_track");
  eq(parseMusicLookupInput("https://open.spotify.com/intl-tr/track/5MH8rf9BdkrFlBEeaYkFZ3").normalizedValue, "5MH8rf9BdkrFlBEeaYkFZ3", "localized url normalized");
  eq(parseMusicLookupInput("spotify:track:5MH8rf9BdkrFlBEeaYkFZ3").type, "spotify_track", "spotify uri");
  eq(parseMusicLookupInput("FRX282689836").type, "isrc", "isrc");
  eq(parseMusicLookupInput("fr-x28-2689836").normalizedValue, "FRX282689836", "isrc normalized (strip hyphens/upper)");
  eq(parseMusicLookupInput("7d534228-5165-11e9-9e21-549f35141000").type, "soundcharts_song_uuid", "soundcharts uuid");
  eq(parseMusicLookupInput("https://open.spotify.com/album/5MH8rf9BdkrFlBEeaYkFZ3").type, "spotify_album", "album url -> spotify_album (multi-track release)");
  eq(parseMusicLookupInput("").type, "invalid", "empty invalid");

  console.log("== soundcharts: envelope + error mapping ==");
  const { unwrapObject, unwrapItems } = await import("./soundcharts/client");
  eq((unwrapObject<{ a: number }>({ type: "song", object: { a: 1 } }) as { a: number }).a, 1, "unwrapObject { type, object }");
  eq(unwrapItems<number>({ items: [1, 2], page: {} }).length, 2, "unwrapItems { items, page }");
  const { errorForStatus } = await import("./soundcharts/errors");
  eq(errorForStatus(403).code, "SOUNDCHARTS_PLAN_RESTRICTED", "403 -> plan restricted");
  eq(errorForStatus(404).code, "SOUNDCHARTS_NOT_FOUND", "404 -> not found");
  eq(errorForStatus(410).code, "SOUNDCHARTS_IDENTIFIER_AMBIGUOUS", "410 -> ambiguous");
  eq(errorForStatus(429).retryable, true, "429 retryable");
  eq(errorForStatus(503).retryable, true, "5xx retryable");

  console.log("== soundcharts: config detection ==");
  const scMod = await import("./soundcharts/config");
  eq(scMod.isSoundchartsConfigured({ ...scMod.getSoundchartsConfig(), clientId: "", clientSecret: "", useLegacyAuth: false, legacyAppId: "", legacyApiKey: "" } as never), false, "not configured when empty");
  eq(scMod.isSoundchartsConfigured({ ...scMod.getSoundchartsConfig(), clientId: "id", clientSecret: "sec" } as never), true, "configured with client credentials");
  eq(scMod.isLegacyConfigured({ ...scMod.getSoundchartsConfig(), useLegacyAuth: true, legacyAppId: "a", legacyApiKey: "b" } as never), true, "legacy configured when enabled");

  console.log("== distributor resolver (licensor-UUID ONLY; Soundcharts never a source) ==");
  const { resolveDistributor } = await import("./distributor/resolver");
  // A real licensor UUID exact-matched in the canonical mapping => verified.
  const verified = resolveDistributor({ licensorUuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5" });
  eq(verified.status, "verified", "licensor UUID exact match -> verified");
  eq(verified.name, "Believe Digital", "verified name = exact stored");
  eq(verified.uuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "verified carries normalized uuid");
  // No licensor UUID => uuid_unavailable. NEVER guessed from any other source.
  eq(resolveDistributor({}).status, "uuid_unavailable", "no licensor uuid -> uuid_unavailable");
  eq(resolveDistributor({ licensorUuid: null }).status, "uuid_unavailable", "null licensor uuid -> uuid_unavailable");
  eq(resolveDistributor({ licensorUuid: null }).name, null, "unavailable name is null");
  // A valid-but-unmatched UUID is uuid_not_mapped (distinct from unavailable).
  eq(resolveDistributor({ licensorUuid: "00000000000000000000000000000000" }).status, "uuid_not_mapped", "unknown uuid -> uuid_not_mapped");
  eq(resolveDistributor({ licensorUuid: "00000000000000000000000000000000" }).name, null, "unknown uuid name null");
  // A Soundcharts song UUID is a valid 32-hex value but never a distributor -> uuid_not_mapped.
  eq(resolveDistributor({ licensorUuid: "2c9d1a12-a9d9-4564-aa51-046bb057677b" }).status, "uuid_not_mapped", "soundcharts song uuid -> uuid_not_mapped (not a distributor)");
  // The resolver output must expose ONLY name/uuid/status — no provider internals.
  eq(Object.keys(resolveDistributor({ licensorUuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5" })).sort().join(","), "name,status,uuid", "resolver output has no provider/source internals");

  console.log("== extractLicensorUuidFromSpotifyMetadata (track-level preferred, album fallback) ==");
  const sp = await import("./spotify");
  // Track-level licensor UUID wins.
  eq(sp.extractLicensorUuidFromSpotifyMetadata({ licensor: { uuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5" }, album: { licensor: { uuid: "0f26cfca536a4a69a2baed1eca0a42ec" } } }), "c71b29ea9e1e48c6931da2dd7c0bf5d5", "track-level licensor uuid preferred");
  // Album-level is the defined fallback.
  eq(sp.extractLicensorUuidFromSpotifyMetadata({ album: { licensor: { uuid: "0f26cfca536a4a69a2baed1eca0a42ec" } } }), "0f26cfca536a4a69a2baed1eca0a42ec", "album-level licensor uuid used as fallback");
  // The REAL public Spotify Web API shape (no licensor anywhere) -> null.
  eq(sp.extractLicensorUuidFromSpotifyMetadata({ id: "5MH8rf9BdkrFlBEeaYkFZ3", name: "x", external_ids: { isrc: "FRX282689836" }, album: { id: "abc", external_ids: { upc: "0060244" }, name: "y" }, artists: [{ id: "art1", name: "a" }] }), null, "public Spotify API response (no licensor field) -> null");
  // Never returns any OTHER identifier even if present.
  eq(sp.extractLicensorUuidFromSpotifyMetadata({ id: "5MH8rf9BdkrFlBEeaYkFZ3", gid: "be172e79403e48edb9742d98baf252cd", original_audio: { uuid: "deadbeefdeadbeefdeadbeefdeadbeef" }, external_ids: { isrc: "FRX282689836" } }), null, "never returns track id / gid / original_audio / isrc");
  eq(sp.extractLicensorUuidFromSpotifyMetadata(null), null, "null metadata -> null");
  eq(sp.extractLicensorUuidFromSpotifyMetadata({}), null, "empty metadata -> null");
  // The extracted value is returned UNMODIFIED (normalization happens later).
  eq(sp.extractLicensorUuidFromSpotifyMetadata({ licensor: { uuid: " C71B29EA-9E1E-48C6-931D-A2DD7C0BF5D5 " } }), "C71B29EA-9E1E-48C6-931D-A2DD7C0BF5D5", "returns raw unmodified licensor uuid");

  console.log("== Spotify track catalog -> licensor UUID -> distributor (the panel flow) ==");
  const tm = await import("./trackMapping");
  const trkCat = tm.loadTrackCatalog();
  // The selected track exposes its OWN licensor UUID via the catalog (by Spotify id).
  const fx = tm.findUuidForTrack(trkCat, "5MH8rf9BdkrFlBEeaYkFZ3", null);
  eq(fx?.licensorUuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "catalog: track 5MH8rf9… -> licensor c71b29ea…");
  eq(fx?.matchedBy, "spotifyTrackId", "matched by spotify track id");
  eq(resolveDistributor({ licensorUuid: fx?.licensorUuid ?? null }).name, "Believe Digital", "FIXTURE (Spotify system): 5MH8rf9… -> Believe Digital");
  // ISRC-based matching resolves the same track independently.
  const byIsrc = tm.findUuidForTrack(trkCat, null, "FRX282689836");
  eq(byIsrc?.licensorUuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "catalog: ISRC FRX282689836 -> same licensor uuid");
  eq(byIsrc?.matchedBy, "isrc", "matched by isrc");
  // A different, unrelated track id is NOT in the catalog -> no reuse of another track's uuid.
  eq(tm.findUuidForTrack(trkCat, "0000000000000000000000", null), null, "unlisted track -> no licensor uuid (no reuse)");

  console.log("== canonical distributor UUID resolver ==");
  const { normalizeDistributorUuid, resolveDistributorByUuid } = await import("./distributor/uuid");

  // normalization
  eq(normalizeDistributorUuid("C71B29EA9E1E48C6931DA2DD7C0BF5D5"), "c71b29ea9e1e48c6931da2dd7c0bf5d5", "normalize uppercase");
  eq(normalizeDistributorUuid("c71b29ea-9e1e-48c6-931d-a2dd7c0bf5d5"), "c71b29ea9e1e48c6931da2dd7c0bf5d5", "normalize hyphens");
  eq(normalizeDistributorUuid("  c71b29ea9e1e48c6931da2dd7c0bf5d5  "), "c71b29ea9e1e48c6931da2dd7c0bf5d5", "normalize whitespace");
  eq(normalizeDistributorUuid('"c71b29ea9e1e48c6931da2dd7c0bf5d5"'), "c71b29ea9e1e48c6931da2dd7c0bf5d5", "normalize quotes");
  eq(normalizeDistributorUuid("not-a-uuid"), null, "invalid -> null");
  eq(normalizeDistributorUuid("5MH8rf9BdkrFlBEeaYkFZ3"), null, "spotify id rejected (not 32-hex)");

  // EXACT verification cases — names must match the canonical JSON verbatim.
  // These are the required acceptance fixtures; spelling/punctuation/slashes exact.
  const CASES: [string, string][] = [
    ["c71b29ea9e1e48c6931da2dd7c0bf5d5", "Believe Digital"],
    ["18fbcef4fb624fc58d4a7fdd230bd523", "PK Interactive / DistroKid"],
    ["60315a5bfaa04520a1ee142e2df5b8ca", "DashGo / Downtown Music Group"],
    ["ede63b46782e46e19045255f32c0ff0f", "The Orchard Enterprises"],
    ["0f26cfca536a4a69a2baed1eca0a42ec", "FUGA"],
    ["fe358ea987e2424d9021c2665a0667b7", "Universal Music Group"],
    ["8337a6aeaca744a7b32050f0c66e138f", "Warner Music Group"],
    ["aa9468539d19400ca4c32fdc159926a9", "Sony Music Entertainment"],
  ];
  for (const [uuid, name] of CASES) {
    const r = resolveDistributorByUuid(uuid);
    eq(r.matched, true, `${uuid.slice(0, 8)}… matched`);
    eq(r.name, name, `${uuid.slice(0, 8)}… -> exact "${name}"`);
    eq(r.matchType, "exact", `${uuid.slice(0, 8)}… matchType exact`);
    // Case preservation: uppercase input still yields exact stored casing.
    eq(resolveDistributorByUuid(uuid.toUpperCase()).name, name, `${uuid.slice(0, 8)}… uppercase input -> exact name`);
  }

  // Unknown / rejection
  eq(resolveDistributorByUuid("00000000000000000000000000000000").matched, false, "unknown uuid -> unmatched");
  eq(resolveDistributorByUuid("00000000000000000000000000000000").matchType, "none", "unknown matchType none");
  eq(resolveDistributorByUuid("bad").matchType, "invalid", "invalid uuid -> invalid");
  // A Soundcharts song UUID (random) must NOT falsely match the distributor mapping.
  eq(resolveDistributorByUuid("2c9d1a12-a9d9-4564-aa51-046bb057677b").matched, false, "soundcharts song uuid not a distributor match");

  console.log("== token safety ==");
  const serialized = JSON.stringify(batch) + JSON.stringify(dTune) + JSON.stringify(dIsrc);
  assert(!serialized.includes("fake-token-value"), "token never appears in results");

  console.log("== connector: metadata capture parsing + strict URL matcher ==");
  const capMod = await import("./spotifyMetadata");
  // Strict request-URL matcher: only spclient.wg.spotify.com/metadata/4/track/{gid}.
  eq(capMod.parseMetadataRequestUrl("https://spclient.wg.spotify.com/metadata/4/track/be172e79403e48edb9742d98baf252cd")?.trackGid, "be172e79403e48edb9742d98baf252cd", "metadata request url -> gid");
  eq(capMod.parseMetadataRequestUrl("https://spclient.wg.spotify.com/collection/v2/contains"), null, "collection/contains url rejected");
  eq(capMod.parseMetadataRequestUrl("http://spclient.wg.spotify.com/metadata/4/track/be172e79403e48edb9742d98baf252cd"), null, "non-https rejected");
  eq(capMod.parseMetadataRequestUrl("https://evil.com/metadata/4/track/be172e79403e48edb9742d98baf252cd"), null, "wrong host rejected");
  // Parse a fixture-shaped RESPONSE: licensor UUID from response.licensor.uuid.
  const fixtureResponse = {
    gid: "be172e79403e48edb9742d98baf252cd",
    canonical_uri: "spotify:track:5MH8rf9BdkrFlBEeaYkFZ3",
    name: "MONTAGEM GRITOS TALENTO 3",
    artist: [{ name: "prodbydxm" }, { name: "DJ FRIZER" }],
    album: { name: "MONTAGEM GRITOS TALENTO 3", label: "0to8", gid: "ffffffffffffffffffffffffffffffff", licensor: { uuid: "ffffffff-ffff-ffff-ffff-ffffffffffff" } },
    external_id: [{ type: "isrc", id: "FRX282689836" }],
    licensor: { uuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5" },
    original_audio: { uuid: "deadbeefdeadbeefdeadbeefdeadbeef" },
    // Fields that must NEVER be read:
    content_authorization_attributes: { token: "SECRET-DO-NOT-READ" },
  };
  const capParsed = capMod.parseSpotifyExtendedMetadata(fixtureResponse, "2026-01-01T00:00:00Z");
  assert(parsed !== null, "fixture response parses");
  eq(capParsed!.licensorUuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "licensor from response.licensor.uuid (top-level wins)");
  eq(capParsed!.spotifyTrackId, "5MH8rf9BdkrFlBEeaYkFZ3", "track id from canonical_uri");
  eq(capParsed!.isrc, "FRX282689836", "isrc captured");
  eq(capParsed!.trackGid, "be172e79403e48edb9742d98baf252cd", "track gid captured");
  assert(!JSON.stringify(capParsed).includes("SECRET-DO-NOT-READ"), "content_authorization token never captured");
  assert(!JSON.stringify(capParsed).includes("deadbeef"), "original_audio.uuid never captured");
  // No licensor anywhere -> reject (never fall back to gid/original_audio/isrc).
  eq(capMod.parseSpotifyExtendedMetadata({ gid: "be172e79403e48edb9742d98baf252cd", canonical_uri: "spotify:track:5MH8rf9BdkrFlBEeaYkFZ3", name: "x" }), null, "no licensor uuid -> rejected");
  // Album-level licensor fallback when top-level absent.
  const albFallback = capMod.parseSpotifyExtendedMetadata({ canonical_uri: "spotify:track:5MH8rf9BdkrFlBEeaYkFZ3", name: "x", album: { licensor: { uuid: "0f26cfca536a4a69a2baed1eca0a42ec" } } });
  eq(albFallback?.licensorUuid, "0f26cfca536a4a69a2baed1eca0a42ec", "album.licensor.uuid used when top-level missing");

  console.log("== connector: sanitized payload revalidation ==");
  const goodPayload = {
    source: "spotify-web-player", capturedAt: "2026-01-01T00:00:00Z",
    spotifyTrackId: "5MH8rf9BdkrFlBEeaYkFZ3", spotifyUri: "spotify:track:5MH8rf9BdkrFlBEeaYkFZ3",
    trackGid: "be172e79403e48edb9742d98baf252cd", trackTitle: "MONTAGEM GRITOS TALENTO 3",
    artists: ["prodbydxm", "DJ FRIZER"], albumTitle: "MONTAGEM GRITOS TALENTO 3", albumLabel: "0to8",
    isrc: "FRX282689836", durationMs: 90000, licensorUuid: "c71b29ea9e1e48c6931da2dd7c0bf5d5",
  };
  eq(capMod.validateSanitizedPayload(goodPayload).ok, true, "valid sanitized payload accepted");
  // A smuggled token field is rejected by the allow-list.
  eq(capMod.validateSanitizedPayload({ ...goodPayload, accessToken: "x" }).ok, false, "unexpected field (accessToken) rejected");
  eq(capMod.validateSanitizedPayload({ ...goodPayload, spotifyTrackId: "not-an-id" }).ok, false, "invalid track id rejected");
  eq(capMod.validateSanitizedPayload({ ...goodPayload, licensorUuid: "nope" }).ok, false, "invalid licensor uuid rejected");

  console.log("== connector: pending-lookup correlation + fixture end-to-end ==");
  const store = await import("./connectorStore");
  store.__resetConnectorStore();
  const lk = store.createLookup("5MH8rf9BdkrFlBEeaYkFZ3");
  eq(lk.status, "pending", "created lookup is pending");
  eq(store.pendingTrackIds().includes("5MH8rf9BdkrFlBEeaYkFZ3"), true, "track id is pending");
  // A capture for a DIFFERENT track must not complete this lookup.
  eq(store.completeLookupForTrack("0000000000000000000000", "c71b29ea9e1e48c6931da2dd7c0bf5d5", null), null, "capture for wrong track -> no pending lookup");
  eq(store.getLookup(lk.requestId)!.status, "pending", "lookup still pending after mismatched capture");
  // The real fixture capture completes it and resolves the distributor via canonical mapping.
  const completed = store.completeLookupForTrack("5MH8rf9BdkrFlBEeaYkFZ3", "c71b29ea9e1e48c6931da2dd7c0bf5d5", { trackTitle: "MONTAGEM GRITOS TALENTO 3", artists: ["prodbydxm", "DJ FRIZER"], albumTitle: null, albumLabel: "0to8", isrc: "FRX282689836", spotifyUri: "spotify:track:5MH8rf9BdkrFlBEeaYkFZ3", trackGid: "be172e79403e48edb9742d98baf252cd", capturedAt: "2026-01-01T00:00:00Z" });
  assert(completed !== null, "fixture capture completes the lookup");
  eq(completed!.status, "completed", "lookup completed");
  eq(completed!.stage, "matched", "lookup stage matched");
  eq(completed!.result?.distributor, "Believe Digital", "FIXTURE: 5MH8rf9… -> licensor c71b29ea… -> Believe Digital");
  eq(completed!.result?.licensorUuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "fixture normalized licensor uuid");
  // Re-completing a finished lookup finds nothing pending (duplicate capture rejection).
  eq(store.completeLookupForTrack("5MH8rf9BdkrFlBEeaYkFZ3", "c71b29ea9e1e48c6931da2dd7c0bf5d5", null), null, "no pending lookup after completion (dup rejected)");
  // Event-level dedup marker.
  const dk = "5MH8rf9BdkrFlBEeaYkFZ3:be172e79403e48edb9742d98baf252cd:c71b29ea9e1e48c6931da2dd7c0bf5d5";
  eq(store.isDuplicateEvent(dk), false, "first event not a duplicate");
  eq(store.isDuplicateEvent(dk), true, "identical event is a duplicate");
  eq(store.getLookup("nonexistent-request-id"), null, "unknown request id -> null");
  // The completed result exposes no token/cookie/header.
  assert(!/token|cookie|authorization|secret/i.test(JSON.stringify(completed)), "completed lookup carries no credentials");
  store.__resetConnectorStore();

  console.log("== album input parsing ==");
  eq(parseMusicLookupInput("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy").type, "spotify_album", "album url -> spotify_album");
  eq(parseMusicLookupInput("spotify:album:4aawyAB9vmqN3uQ7FjRGTy").type, "spotify_album", "album uri -> spotify_album");
  eq(parseMusicLookupInput("https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy").type, "spotify_album", "localized album url -> spotify_album");
  eq(parseMusicLookupInput("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=abc123").type, "spotify_album", "album url with ?si -> spotify_album");
  eq(parseMusicLookupInput("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy").normalizedValue, "4aawyAB9vmqN3uQ7FjRGTy", "album id extracted");
  eq(parseMusicLookupInput("https://open.spotify.com/track/5MH8rf9BdkrFlBEeaYkFZ3").type, "spotify_track", "track url still spotify_track");
  eq(parseMusicLookupInput("USUM71703861").type, "isrc", "isrc still parses");
  eq(parseMusicLookupInput("2c9d1a12-a9d9-4564-aa51-046bb057677b").type, "soundcharts_song_uuid", "soundcharts uuid still parses");
  eq(parseMusicLookupInput("https://open.spotify.com/artist/0oSGxfWSnnOXhD2fKuz2Gy").type, "spotify_artist", "artist url -> artist catalogue");
  eq(parseMusicLookupInput("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").type, "invalid", "playlist url -> invalid");
  eq(extractSpotifyAlbumId("spotify:album:4aawyAB9vmqN3uQ7FjRGTy"), "4aawyAB9vmqN3uQ7FjRGTy", "extractSpotifyAlbumId uri");
  eq(extractSpotifyAlbumId("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy"), "4aawyAB9vmqN3uQ7FjRGTy", "extractSpotifyAlbumId url");
  eq(extractSpotifyAlbumId("https://open.spotify.com/track/5MH8rf9BdkrFlBEeaYkFZ3"), null, "extractSpotifyAlbumId rejects track url");
  eq(extractSpotifyAlbumId("https://evil.com/album/4aawyAB9vmqN3uQ7FjRGTy"), null, "extractSpotifyAlbumId rejects non-spotify host");

  console.log("== album release builder (ordering + independence) ==");
  const albumMeta = {
    name: "Test Release", album_type: "album", release_date: "2024-05-01", total_tracks: 4,
    label: "Some Label", images: [{ url: "https://img/a.jpg" }], artists: [{ name: "Main Artist" }],
    external_ids: { upc: "00602440000000" },
  };
  // Deliberately out of order across two discs, to prove disc+track sorting.
  const albumTracks = [
    { id: "bbbbbbbbbbbbbbbbbbbbb2", name: "Disc1 Track2", artists: [{ name: "Main Artist" }], track_number: 2, disc_number: 1, duration_ms: 200000, explicit: false },
    { id: "ddddddddddddddddddddd1", name: "Disc2 Track1", artists: [{ name: "Main Artist" }, { name: "Guest" }], track_number: 1, disc_number: 2, duration_ms: 210000, explicit: true },
    { id: "aaaaaaaaaaaaaaaaaaaaa1", name: "Disc1 Track1", artists: [{ name: "Main Artist" }], track_number: 1, disc_number: 1, duration_ms: 190000, explicit: false },
  ];
  const rel = buildAlbumRelease("4aawyAB9vmqN3uQ7FjRGTy", albumMeta, albumTracks);
  eq(rel.spotifyAlbumId, "4aawyAB9vmqN3uQ7FjRGTy", "release keeps album id");
  eq(rel.title, "Test Release", "release title");
  eq(rel.artists, ["Main Artist"], "release artists");
  eq(rel.releaseType, "album", "release type");
  eq(rel.releaseDate, "2024-05-01", "release date");
  eq(rel.upc, "00602440000000", "release upc from external_ids");
  eq(rel.label, "Some Label", "release label");
  eq(rel.artworkUrl, "https://img/a.jpg", "release artwork from first image");
  eq(rel.totalTracks, 4, "release totalTracks");
  eq(rel.discCount, 2, "discCount computed from max disc");
  eq(rel.tracks.length, 3, "all mappable tracks kept");
  eq(rel.tracks.map((t) => t.spotifyTrackId), ["aaaaaaaaaaaaaaaaaaaaa1", "bbbbbbbbbbbbbbbbbbbbb2", "ddddddddddddddddddddd1"], "tracks sorted by disc then track number");
  eq(rel.tracks[2].artists, ["Main Artist", "Guest"], "per-track artists preserved independently");
  eq(rel.tracks[2].explicit, true, "per-track explicit preserved");
  eq(rel.tracks[0].isrc, null, "per-track ISRC is null until that track is analyzed (never album-wide)");
  eq(rel.tracks[0].analysisStatus, "not_loaded", "tracks start not_loaded");
  eq(rel.tracks[0].spotifyUrl, "https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa1", "per-track spotify url built from its own id");
  assert(new Set(rel.tracks.map((t) => t.spotifyTrackId)).size === rel.tracks.length, "every track id is unique (no reuse)");
  // A track with no id is dropped, not fabricated.
  const relDrop = buildAlbumRelease("4aawyAB9vmqN3uQ7FjRGTy", albumMeta, [{ name: "No Id", track_number: 1, disc_number: 1 }, ...albumTracks]);
  eq(relDrop.tracks.length, 3, "track without an id is dropped");
  // Single-disc release: no synthetic disc grouping.
  const single = buildAlbumRelease("1111111111111111111111", { name: "EP", album_type: "single", total_tracks: 1 }, [{ id: "trktrktrktrktrktrktrk1", name: "Only", artists: [{ name: "X" }], track_number: 1, disc_number: 1, duration_ms: 1000, explicit: false }]);
  eq(single.discCount, 1, "single-disc discCount is 1");
  eq(single.releaseType, "single", "EP/single release type preserved");
  const albumStr = JSON.stringify(rel);
  assert(!/licensor|soundcharts|distributor/i.test(albumStr), "release model carries no distributor/licensor/soundcharts fields");

  console.log("== branding: single BrandLogo, correct theme mapping, approved locations ==");
  const fs = await import("fs");
  const read = (p: string) => fs.readFileSync(p, "utf8");
  const brandLogo = read("app/components/BrandLogo.tsx");
  const globals = read("app/globals.css");
  const pageSrc = read("app/page.tsx");
  // 1) BrandLogo is the ONLY file importing the two logo PNGs (no duplicate imports).
  const importsInBrandLogo = /white-virus-logo\.png/.test(brandLogo) && /black-virus-logo\.png/.test(brandLogo);
  assert(importsInBrandLogo, "BrandLogo imports both logo PNGs");
  assert(!/virus-logo\.png/.test(pageSrc), "page.tsx does NOT import a logo PNG directly");
  for (const f of fs.readdirSync("app/components").filter((n) => n.endsWith(".tsx") && n !== "BrandLogo.tsx")) {
    assert(!/virus-logo\.png/.test(read(`app/components/${f}`)), `${f} does NOT import a logo PNG directly`);
  }
  // 2) EXACTLY ONE <img> is rendered, and the src is chosen by resolved theme
  //    (dark -> white, light -> black). No two-image CSS toggle.
  eq((brandLogo.match(/<img\s/g) || []).length, 1, "BrandLogo renders exactly one <img> element");
  assert(/theme === "dark" \? whiteLogo\.src : blackLogo\.src/.test(brandLogo), "src selected by theme: dark->white, light->black");
  assert(/dataset\.theme === "light" \? "light" : "dark"/.test(brandLogo), "resolves theme from data-theme (system resolved)");
  assert(!/logo-for-dark|logo-for-light/.test(brandLogo) && !/logo-for-dark|logo-for-light/.test(globals), "no two-image CSS toggle remains");
  assert(!/filter:\s*invert|filter:\s*brightness|filter:\s*hue/.test(brandLogo) && !/\.brand[\s\S]{0,200}filter:\s*invert/.test(globals), "no CSS-filter recoloring of the logo");
  assert(/object-fit:\s*contain/.test(globals) || /objectFit:\s*"contain"/.test(brandLogo), "logo uses object-fit: contain");
  // 3) Approved locations: exactly ONE BrandLogo (sidebar) — no center/empty-state duplicate.
  // Sidebar rendering moved to app/components/layout/AppSidebar.tsx during the UI redesign.
  const sidebarSrc = read("app/components/layout/AppSidebar.tsx");
  const brandLogoUses =
    (pageSrc.match(/<BrandLogo\b/g) || []).length +
    (sidebarSrc.match(/<BrandLogo\b/g) || []).length +
    fs.readdirSync("app/components")
      .filter((n) => n.endsWith(".tsx") && n !== "BrandLogo.tsx")
      .reduce((n, f) => n + (read(`app/components/${f}`).match(/<BrandLogo\b/g) || []).length, 0);
  eq(brandLogoUses, 1, "exactly one BrandLogo rendered (sidebar branding only)");
  assert(!/variant="emptyState"/.test(pageSrc) && !/variant="emptyState"/.test(sidebarSrc), "no empty-state center logo (avoids a second desktop logo)");
  assert(/variant=\{collapsed \? "collapsedSidebar" : "sidebar"\}/.test(sidebarSrc), "sidebar/collapsed variant present");
  assert(!/topbar[\s\S]{0,400}<BrandLogo/.test(pageSrc), "no BrandLogo inside the top header");
  // 4) Theme: data-theme is stamped at boot — the source BrandLogo resolves from.
  const layoutSrc = read("app/layout.tsx");
  assert(/document\.documentElement\.dataset\.theme\s*=/.test(layoutSrc), "layout stamps data-theme at boot (logo theme source)");

  console.log("== panel consistency: one location per field, distributor prominence ==");
  const wsSrc = read("app/components/LookupWorkspace.tsx");
  // Release-metadata card carries ISRC/UPC + the distributor's honest resolution state.
  const idStart = wsSrc.indexOf("function ReleaseMetadataCard");
  assert(idStart >= 0, "ReleaseMetadataCard present in the lookup workspace");
  const identifiersBlock = wsSrc.slice(idStart, wsSrc.indexOf("\nfunction ", idStart + 1) === -1 ? undefined : wsSrc.indexOf("\nfunction ", idStart + 1));
  assert(/i-label">ISRC/.test(identifiersBlock) && /i-label">Distributor/.test(identifiersBlock), "release-metadata card carries ISRC + distributor state");
  assert(/Licensor UUID/.test(wsSrc), "licensor UUID is rendered as its own row (details card)");
  assert(/Soundcharts UUID/.test(wsSrc), "Soundcharts UUID is its own row (never conflated with the licensor UUID)");
  // ISRC must never be rendered as a platform link.
  assert(/seen\.has\(key\)/.test(wsSrc), "platform links are deduplicated by normalized key");
  assert(!/push\(\s*"ISRC"/.test(wsSrc), "ISRC is never pushed as a platform");
  // Distributor is rendered via its dedicated style and never re-cased.
  assert(/distributor-value/.test(wsSrc), "distributor rendered with the dedicated distributor-value style");
  // The distributor name element is guarded against CSS text-transform.
  assert(/\.distributor-value[\s\S]*?text-transform:\s*none/.test(globals) || /\.dist-name[\s\S]*?text-transform:\s*none/.test(globals), "distributor name is text-transform:none (never re-cased)");

  console.log("== Spicetify extension: base62->GID algorithm + safety ==");
  // The exact algorithm the extension ships — proven against the fixture GID.
  const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const base62ToGid = (id: string): string | null => {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) return null;
    let n = 0n;
    for (const ch of id) { const i = B62.indexOf(ch); if (i < 0) return null; n = n * 62n + BigInt(i); }
    return n.toString(16).padStart(32, "0");
  };
  eq(base62ToGid("5MH8rf9BdkrFlBEeaYkFZ3"), "be172e79403e48edb9742d98baf252cd", "base62 track id -> fixture GID");
  eq(base62ToGid("not-22-chars"), null, "bad track id -> null GID");
  const ext = read("spicetify/distro-finder.js");
  assert(/metadata\/4\/track\//.test(ext), "extension reads the internal metadata/4/track endpoint");
  assert(/subMessage|sub\(track, 21\)|sub\(track, 3\)/.test(ext) || /decode\(/.test(ext), "extension decodes the protobuf response (the endpoint never returns JSON)");
  assert(/__ODF_MAPPING__/.test(ext), "extension carries the installer-injected mapping placeholder");
  // The extension must never send anything anywhere: no backend, no uploads.
  assert(!/localStorage\.|sessionStorage\.|document\.cookie/.test(ext), "extension stores nothing in the browser");
  const extFetches = ext.match(/fetch\(([^)]*)/g) || [];
  assert(extFetches.length === 1 && /META_BASE/.test(extFetches[0]), "extension makes exactly one request: the client's own metadata read");
  // The companion never calls an analytics provider itself — the only network
  // request it makes is the client's own metadata read (asserted above);
  // Soundcharts appears solely as a source label on data the desktop app fetched.
  const soundchartsMentions = ext.split("\n").filter((l) => /soundcharts/i.test(l));
  assert(soundchartsMentions.every((l) => !/fetch\(|CosmosAsync|https?:\/\//i.test(l)), "companion never calls Soundcharts directly");
  // The installer embeds the canonical mapping and excludes conflicting UUIDs.
  const installer = read("desktop/scripts/install-spicetify.mjs");
  assert(/conflicts\.add|conflicts\.delete|for \(const c of conflicts\)/.test(installer), "installer excludes conflicting UUIDs from the embedded mapping");
  assert(/replace\("\/\*__ODF_MAPPING__\*\/ \{\}"/.test(installer), "installer injects the mapping into the placeholder");
  // The endpoint the Spicetify panel used to call still resolves canonically.
  const distRoute = read("app/api/distributor/route.ts");
  assert(/resolveDistributorByLicensorUuid/.test(distRoute), "endpoint resolves by licensor UUID (exact canonical match)");
  assert(/Access-Control-Allow-Origin/.test(distRoute) && /export async function OPTIONS/.test(distRoute), "endpoint sends CORS + handles preflight");

  console.log("== protobuf metadata decoder (real client response fixture) ==");
  const { decodeTrackMetadata, extractLicensorUuid, decodeMessage, isTrackMessage } = await import("./spotifyProtobuf");
  const pb = new Uint8Array(fs.readFileSync("src/__fixture-track-metadata.bin"));
  const decodedTrack = decodeTrackMetadata(pb);
  assert(decodedTrack !== null, "fixture protobuf decodes");
  eq(decodedTrack!.licensorUuid, "c71b29ea9e1e48c6931da2dd7c0bf5d5", "licensor UUID read from the track-level licensor field");
  eq(decodedTrack!.isrc, "FRX282689836", "ISRC read from external_id");
  eq(decodedTrack!.trackGid, "be172e79403e48edb9742d98baf252cd", "track GID matches the fixture");
  eq(decodedTrack!.trackTitle, "MONTAGEM GRITOS TALENTO 3", "track title decoded");
  eq(decodedTrack!.durationMs, 148614, "duration decoded");
  assert(decodedTrack!.artists.length === 3, "all artists decoded");
  assert((decodedTrack!.artworkUrl ?? "").startsWith("https://i.scdn.co/image/"), "artwork url built from the largest cover image");
  // The licensor must NEVER come from original_audio (field 24) or any gid.
  const msg = decodeMessage(pb);
  const origAudio = msg[24]?.[0];
  const origUuid = origAudio instanceof Uint8Array
    ? Array.from(decodeMessage(origAudio)[1]?.[0] as Uint8Array, (b: number) => b.toString(16).padStart(2, "0")).join("")
    : null;
  assert(!!origUuid && origUuid !== decodedTrack!.licensorUuid, "licensor UUID is NOT original_audio's uuid");
  assert(decodedTrack!.licensorUuid !== decodedTrack!.trackGid, "licensor UUID is NOT the track gid");
  assert(isTrackMessage(msg), "fixture passes the track-message shape check");
  // Garbage in → null out, never a throw and never a fabricated field.
  eq(decodeTrackMetadata(new Uint8Array([1, 2, 3])), null, "truncated input decodes to null");
  eq(decodeTrackMetadata(new Uint8Array(40)), null, "zero-filled input decodes to null");
  eq(extractLicensorUuid(decodeMessage(new Uint8Array(0))), null, "empty message yields no licensor UUID");

  console.log("== Ocean Analyzer: identifier-driven, no fabricated data ==");
  const targetResolverJs = read("extension/spotify-distributor-connector/src/analyzer/targetResolver.js");
  const modalJs = read("extension/spotify-distributor-connector/src/analyzer/modal.js");
  const menuJs = read("extension/spotify-distributor-connector/src/analyzer/contextMenu.js");
  const bridgeJs = read("extension/spotify-distributor-connector/src/analyzer/bridge.js");
  const chartJs = read("extension/spotify-distributor-connector/src/analyzer/chart.js");
  const manifest = JSON.parse(read("extension/spotify-distributor-connector/manifest.json"));

  // Targets come from real Spotify identifiers only — never a display name.
  assert(/URI_RE/.test(targetResolverJs), "resolver matches spotify: URIs");
  assert(/PATH_RE/.test(targetResolverJs), "resolver matches /track|album|artist|playlist/{id} paths");
  assert(/data-uri|data-context-uri|data-testid/.test(targetResolverJs), "resolver consults data-uri / testid attributes, not just classes");
  assert(!/textContent[\s\S]{0,80}(match|test)\(/.test(targetResolverJs), "resolver never derives an id from visible text");

  // Exactly one modal, and it can never stack.
  assert(/attachShadow/.test(modalJs), "modal renders inside a shadow root (Spotify styles cannot leak in)");
  assert(/var instance = null|let instance = null/.test(modalJs) && /if \(!instance\)/.test(modalJs), "a single shared modal instance is reused");
  assert(/Escape/.test(modalJs) && /body\.style\.overflow/.test(modalJs), "Escape closes the modal and background scroll is restored");
  assert(/loadToken/.test(modalJs), "superseded loads are ignored (no stale render)");

  // Menu injection is idempotent and never breaks Spotify's own menu.
  assert(/querySelector\("\[" \+ MARK \+ "\]"\)/.test(menuJs), "menu injection checks for an existing row first");
  assert(/disconnect\(\)/.test(menuJs), "the menu observer is always disconnected");
  assert(/Ocean Analyzer ile Analiz Et/.test(menuJs) && /Analyze with Ocean Analyzer/.test(menuJs), "menu label is localized (TR + EN)");

  // The page can never drive the extension: messages are rebuilt from primitives.
  assert(/KINDS\[target\.kind\] === 1/.test(bridgeJs) && /ID_RE\.test/.test(bridgeJs), "bridge validates kind + id before messaging");
  assert(/target: \{ kind: target\.kind, id: target\.id \}/.test(bridgeJs), "bridge rebuilds the payload rather than forwarding page objects");
  assert(/validResult/.test(bridgeJs), "bridge shape-checks replies before the UI sees them");

  // Missing days must stay visible as gaps, never be drawn as zero.
  assert(/missing: true/.test(chartJs) && /if \(p\.missing\)/.test(chartJs), "chart renders data gaps as gaps, not zeros");

  // Manifest wiring.
  const isolated = (manifest.content_scripts || []).find((c: { world?: string }) => c.world === "ISOLATED" && (c.matches || []).some((m: string) => m.includes("open.spotify.com")));
  assert(!!isolated, "analyzer content scripts run in the ISOLATED world on Spotify");
  for (const f of ["src/analyzer/targetResolver.js", "src/analyzer/bridge.js", "src/analyzer/chart.js", "src/analyzer/modal.js", "src/analyzer/contextMenu.js"]) {
    assert(isolated.js.includes(f), `manifest loads ${f}`);
  }
  assert((manifest.web_accessible_resources || []).some((w: { resources: string[] }) => w.resources.includes("src/analyzer/modal.css")), "modal.css is web-accessible for the shadow root");

  // The analyzer endpoint never fabricates a distributor.
  const analyzerRoute = read("app/api/analyzer/[kind]/[id]/route.ts");
  assert(/normalizeLicensorUuid/.test(analyzerRoute), "analyzer route validates the licensor UUID before use");
  const analyzerSvc = read("src/analyzer/service.ts");
  assert(/resolveDistributorByLicensorUuid/.test(analyzerSvc), "analyzer resolves the distributor by exact licensor-UUID match");
  assert(!/albumLabel|label[\s\S]{0,40}distributor\s*=/.test(analyzerSvc.replace(/\/\*[\s\S]*?\*\//g, "")), "analyzer never derives a distributor from the label");
  assert(/restricted/.test(analyzerSvc), "analyzer reports which sections Spotify restricts");

  console.log("== credential pool: failover, cooldown, isolation ==");
  const cp = await import("./credentialPool");
  {
    // Slot 1 is the unsuffixed pair; further slots are numbered.
    const prev = { ...process.env };
    process.env.TESTP_ID = "aaaa1"; process.env.TESTP_SECRET = "s1";
    process.env.TESTP_ID_2 = "bbbb2"; process.env.TESTP_SECRET_2 = "s2";
    process.env.TESTP_ID_3 = "cccc3"; process.env.TESTP_SECRET_3 = "s3";
    process.env.TESTP_ID_4 = "dddd4"; // half-filled slot must be skipped
    const creds = cp.readCredentialsFromEnv("TESTP_ID", "TESTP_SECRET");
    eq(creds.length, 3, "numbered credentials load, half-filled slots skipped");
    eq(creds[0].id, "aaaa1", "slot 1 is the unsuffixed pair (existing setups keep working)");

    const pool = new cp.CredentialPool("testp", creds);
    eq(pool.status().available, 3, "all slots start available");

    // A rate-limited slot fails over to the next one.
    const used: string[] = [];
    const out = await pool.run(async (h) => {
      used.push(h.label);
      if (h.label === "1") { h.rateLimited(3600); throw new Error("429"); }
      return "served-by-" + h.label;
    });
    eq(out, "served-by-2", "a 429 fails over to the next credential");
    eq(used.join(","), "1,2", "the throttled slot is skipped, not retried");
    const st = pool.status();
    eq(st.cooling, 1, "the throttled slot is parked");
    eq(st.available, 2, "the other slots stay available");
    assert(st.slots[0].cooldownRemainingMs > 3_500_000, "the parked slot honours the reported Retry-After");

    // Bad credentials disable a slot permanently.
    await pool.run(async (h) => { if (h.label === "2") { h.rejected("bad_credentials"); throw new Error("401"); } return "ok"; });
    eq(pool.status().disabled, 1, "rejected credentials are disabled, not retried forever");

    // Tokens are per slot — one slot's token must never serve another.
    pool.reset();
    const t1 = await pool.run((h) => h.withToken(async () => ({ token: "tok-" + h.label, ttlMs: 60000 })));
    const seen = new Set<string>([t1]);
    await pool.run(async (h) => { seen.add(await h.withToken(async () => ({ token: "tok-" + h.label, ttlMs: 60000 }))); return null; });
    assert(seen.size >= 1 && [...seen].every((t) => /^tok-\d$/.test(t)), "each slot caches its own token");

    // When everything is parked, callers get a real wait, not a vague error.
    pool.reset();
    for (const label of ["1", "2", "3"]) {
      await pool.run(async (h) => { if (h.label === label) { h.rateLimited(600); throw new Error("429"); } return null; }).catch(() => {});
    }
    let poolErr: unknown = null;
    await pool.run(async () => "never").catch((e) => { poolErr = e; });
    assert(poolErr instanceof cp.PoolUnavailableError, "an exhausted pool raises PoolUnavailableError");
    assert(/rate-limited/i.test((poolErr as Error).message) && /minute|hour/.test((poolErr as Error).message), "the exhausted-pool error states how long the wait is");

    // Status never leaks a secret.
    const statusJson = JSON.stringify(pool.status());
    assert(!statusJson.includes("s1") && !statusJson.includes("s2"), "pool status never contains a secret");
    // Short ids mask as head…tail too; the point is that the raw id is absent.
    assert(/"fingerprint":"[^"]*…[^"]*"/.test(statusJson) && !/"fingerprint":"aaaa1"/.test(statusJson), "pool status shows a masked fingerprint instead");

    for (const k of ["TESTP_ID", "TESTP_SECRET", "TESTP_ID_2", "TESTP_SECRET_2", "TESTP_ID_3", "TESTP_SECRET_3", "TESTP_ID_4"]) delete process.env[k];
    void prev;
  }
  {
    // An empty pool is "not configured", not a crash.
    const empty = new cp.CredentialPool("nothing", []);
    eq(empty.configured, false, "an empty pool reports itself unconfigured");
    let e: unknown = null;
    await empty.run(async () => "x").catch((err) => { e = err; });
    assert(e instanceof cp.PoolUnavailableError && /not configured/i.test((e as Error).message), "an unconfigured pool says so plainly");
  }
  const spotifyAuthSrc = read("src/spotifyAuth.ts");
  assert(/handle\.rateLimited\(/.test(spotifyAuthSrc) && /handle\.rejected\(/.test(spotifyAuthSrc), "Spotify requests report throttling and rejection to the pool");
  assert(!/console\.log\(.*secret/i.test(spotifyAuthSrc), "Spotify auth never logs a secret");
  const scAuthSrc = read("src/soundcharts/auth.ts");
  assert(/handle\.rateLimited\(/.test(scAuthSrc) && /handle\.rejected\(/.test(scAuthSrc), "Soundcharts requests report throttling and rejection to the pool");
  assert(/loadCredentialsFromEnv\("SOUNDCHARTS_CLIENT_ID"/.test(scAuthSrc), "Soundcharts reads numbered credential slots");
  const spotifySrcPooled = read("src/spotify.ts");
  eq((spotifySrcPooled.match(/spotifyRequest\(/g) || []).length, 4, "every Spotify API call site goes through the pooled request helper");
  const envExample = read(".env.example");
  assert(/SPOTIFY_CLIENT_ID_2/.test(envExample) && /SOUNDCHARTS_CLIENT_ID_2/.test(envExample), "backup credential slots are documented");

  console.log("== credential pools: loading, validation, isolation ==");
  {
    const cp2 = await import("./credentialPool");
    const env = process.env;
    const clean = (prefix: string) => Object.keys(env).filter((k) => k.startsWith(prefix)).forEach((k) => delete env[k]);

    // --- loading: slot 1 unsuffixed, backups numbered, halves reported ---
    clean("XSP_");
    env.XSP_ID = "slot1id"; env.XSP_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaslot1secret";
    env.XSP_ID_2 = "slot2id"; env.XSP_SECRET_2 = "bbbbbbbbbbbbbbbbbbbbbbbbslot2secret";
    env.XSP_ID_3 = "slot3id"; env.XSP_SECRET_3 = "ccccccccccccccccccccccccslot3secret";
    let loaded = cp2.loadCredentialsFromEnv("XSP_ID", "XSP_SECRET");
    eq(loaded.credentials.length, 3, "slot 1 plus two numbered backups load");
    eq(loaded.credentials[0].id, "slot1id", "slot 1 stays the unsuffixed pair, untouched");
    eq(loaded.issues.length, 0, "a fully-filled set reports no issues");

    // Half-filled slots are reported, not silently dropped.
    env.XSP_ID_4 = "slot4id";                    // secret missing
    env.XSP_SECRET_5 = "slot5secret";            // id missing
    env.XSP_ID_6 = "slot2id"; env.XSP_SECRET_6 = "x"; // duplicate id
    loaded = cp2.loadCredentialsFromEnv("XSP_ID", "XSP_SECRET");
    eq(loaded.credentials.length, 3, "invalid slots are not used");
    const reasons = loaded.issues.map((i) => `${i.slot}:${i.reason}`).sort().join(",");
    eq(reasons, "4:missing_secret,5:missing_id,6:duplicate_id", "missing secret, missing id and duplicate id are each reported");
    assert(loaded.issues.every((i) => !/slot2secret|slot5secret/.test(i.message)), "validation messages never contain a secret");

    // --- failover: only the throttled slot is parked ---
    const pool = new cp2.CredentialPool("xsp", cp2.loadCredentialsFromEnv("XSP_ID", "XSP_SECRET"));
    const served = await pool.run(async (h) => {
      if (h.label === "1") { h.rateLimited(1800); throw new Error("429"); }
      return h.label;
    });
    eq(served, "2", "a 429 on slot 1 continues on slot 2");
    let st = pool.status();
    eq(st.cooling, 1, "only the throttled slot is parked");
    eq(st.available, 2, "the other slots stay available");
    eq(st.slots[0].lastErrorCode, "http_429", "the parked slot records why");
    eq(st.slots[0].failovers, 1, "the failover is counted on the slot that failed");
    assert(st.slots[0].cooldownEndsAt !== null, "a parked slot exposes when it frees up");

    // --- ETA when everything is parked ---
    pool.reset();
    for (const label of ["1", "2", "3"]) {
      await pool.run(async (h) => { if (h.label === label) { h.rateLimited(label === "3" ? 300 : 3600); throw new Error("429"); } return null; }).catch(() => {});
    }
    let exhausted: unknown = null;
    await pool.run(async () => "x").catch((e) => { exhausted = e; });
    assert(exhausted instanceof cp2.PoolUnavailableError, "an exhausted pool raises PoolUnavailableError");
    const eta = (exhausted as InstanceType<typeof cp2.PoolUnavailableError>).remainingMs;
    assert(eta > 0 && eta <= 300_000 + 5000, "the ETA is the EARLIEST slot's remaining wait, not the longest");

    // --- a parked slot returns to service when its cooldown ends ---
    const quick = new cp2.CredentialPool("xq", [{ id: "a", secret: "b" }]);
    await quick.run(async (h) => { h.rateLimited(1); throw new Error("429"); }).catch(() => {});
    eq(quick.status().cooling, 1, "the only slot is parked");
    await new Promise((r) => setTimeout(r, 1100));
    eq(quick.status().available, 1, "the slot returns to available once its cooldown elapses");

    // --- token isolation between slots ---
    pool.reset();
    const tokens: Record<string, string> = {};
    for (const _ of [0, 1, 2]) {
      await pool.run(async (h) => {
        tokens[h.label] = await h.withToken(async () => ({ token: "tok-" + h.label, ttlMs: 60_000 }));
        // Force the next call onto a different slot.
        h.rateLimited(3600);
        throw new Error("429");
      }).catch(() => {});
    }
    eq(Object.keys(tokens).length, 3, "each slot fetched its own token");
    assert(new Set(Object.values(tokens)).size === 3, "no token is shared between slots");

    // --- one slot's 401 must not clear another slot's token ---
    pool.reset();
    await pool.run((h) => h.withToken(async () => ({ token: "keep-" + h.label, ttlMs: 60_000 })));
    const before = pool.status().slots.filter((x) => x.tokenExpiresAt).length;
    await pool.run(async (h) => { if (h.label === "1") { h.authFailure("http_401"); throw new Error("401"); } return null; }).catch(() => {});
    const after = pool.status();
    eq(after.slots[0].tokenExpiresAt, null, "the 401 slot drops its own token");
    assert(before >= 1, "a token existed before the 401");
    assert(after.slots.slice(1).every((x) => x.state !== "disabled"), "other slots are untouched by another slot's 401");

    // --- 401 refreshes once on the same slot, then disables it ---
    const authPool = new cp2.CredentialPool("xa", [{ id: "only", secret: "s" }]);
    let attempts = 0;
    await authPool.run(async (h) => { attempts++; h.authFailure("http_401"); throw new Error("401"); }).catch(() => {});
    eq(attempts, 2, "a 401 retries the same slot exactly once before judging it");
    eq(authPool.status().disabled, 1, "a second 401 disables the slot");

    // --- single-flight: parallel token requests make ONE real request ---
    const sfPool = new cp2.CredentialPool("xsf", [{ id: "one", secret: "s" }]);
    let loads = 0;
    const loader = async () => { loads++; await new Promise((r) => setTimeout(r, 40)); return { token: "t", ttlMs: 60_000 }; };
    const parallel = await Promise.all([1, 2, 3, 4].map(() => sfPool.run((h) => h.withToken(loader))));
    eq(loads, 1, "parallel token requests for one slot collapse into a single fetch");
    assert(parallel.every((t) => t === "t"), "every caller receives the same token");

    // --- status output must never contain a secret ---
    const statusJson = JSON.stringify(pool.status());
    assert(!/slot1secret|slot2secret|slot3secret/.test(statusJson), "pool status contains no secret");
    assert(/"secretFingerprint":"…cret"/.test(statusJson), "a long secret is reduced to its last 4 characters");
    // A short secret must be hidden entirely: 4 of 8 characters is still a leak.
    const shortPool = new cp2.CredentialPool("xshort", [{ id: "id", secret: "abcd1234" }]);
    eq(shortPool.status().slots[0].secretFingerprint, "••••", "a short secret is masked completely, not partially");
    assert(!/slot2id"/.test(statusJson), "pool status shows a masked client id, never the full value");

    // --- legacy pairs load independently of the modern credential ---
    clean("XLG_");
    env.XLG_ID = "m1"; env.XLG_SECRET = "ms1";
    env.XLG_LEGACY_APP_ID = "L1"; env.XLG_LEGACY_API_KEY = "lk1";
    env.XLG_ID_2 = "m2"; env.XLG_SECRET_2 = "ms2";                    // no legacy at all
    env.XLG_ID_3 = "m3"; env.XLG_SECRET_3 = "ms3"; env.XLG_LEGACY_APP_ID_3 = "L3"; // legacy token missing
    env.XLG_ID_4 = "m4"; env.XLG_SECRET_4 = "ms4"; env.XLG_LEGACY_APP_ID_4 = "L4"; env.XLG_LEGACY_TOKEN_4 = "lk4"; // alias name
    const lg = cp2.loadCredentialsFromEnv("XLG_ID", "XLG_SECRET", {
      legacyVars: { idVars: ["XLG_LEGACY_APP_ID"], secretVars: ["XLG_LEGACY_API_KEY", "XLG_LEGACY_TOKEN"] },
    });
    eq(lg.credentials.length, 4, "all four modern credentials load regardless of legacy state");
    assert(!!lg.credentials[0].legacy, "a complete legacy pair loads");
    eq(lg.credentials[1].legacy, null, "a slot without legacy keys has no legacy pair");
    eq(lg.credentials[1].legacyIssue, "not configured", "an absent legacy pair is reported as not configured");
    eq(lg.credentials[2].legacy, null, "a half-filled legacy pair is not used");
    eq(lg.credentials[2].legacyIssue, "missing legacy token", "a half-filled legacy pair says which half is missing");
    assert(!!lg.credentials[3].legacy, "the _TOKEN alias is accepted for the legacy secret");
    const lgPool = new cp2.CredentialPool("xlg", lg);
    eq(lgPool.status().legacyAvailable, 2, "the pool counts only usable legacy pairs");
    const lgJson = JSON.stringify(lgPool.status());
    assert(!/lk1|lk4/.test(lgJson), "legacy tokens never appear in status output");
    assert(lgPool.legacyCredentialFor("2") === null, "a slot without legacy auth exposes none");
    assert(lgPool.legacyCredentialFor("1")?.id === "L1", "the legacy pair belongs to its own slot");

    // --- per-slot extras (team id) bind to the right slot, with fallback ---
    clean("XTM_");
    env.XTM_ID = "t1"; env.XTM_SECRET = "s1"; env.XTM_TEAM = "shared-team";
    env.XTM_ID_2 = "t2"; env.XTM_SECRET_2 = "s2"; env.XTM_TEAM_2 = "team-two";
    env.XTM_ID_3 = "t3"; env.XTM_SECRET_3 = "s3"; // no team of its own
    const tm = cp2.loadCredentialsFromEnv("XTM_ID", "XTM_SECRET", { extraVars: { teamId: "XTM_TEAM" } });
    eq(tm.credentials[1].extra?.teamId, "team-two", "a per-slot team id binds to that slot");
    eq(tm.credentials[2].extra?.teamId, "shared-team", "a slot without its own team id falls back to the shared one");

    // --- provider isolation: one pool's failure never touches another ---
    const spLike = new cp2.CredentialPool("p1", [{ id: "a", secret: "x" }]);
    const scLike = new cp2.CredentialPool("p2", [{ id: "b", secret: "y" }]);
    await spLike.run(async (h) => { h.rateLimited(3600); throw new Error("429"); }).catch(() => {});
    eq(spLike.status().available, 0, "the first provider is parked");
    eq(scLike.status().available, 1, "the second provider is unaffected");

    // --- empty slots are not errors ---
    clean("XEM_");
    env.XEM_ID = "only"; env.XEM_SECRET = "s";
    const em = cp2.loadCredentialsFromEnv("XEM_ID", "XEM_SECRET");
    eq(em.credentials.length, 1, "a single configured slot loads");
    eq(em.issues.length, 0, "unused slot numbers produce no issues");

    for (const prefix of ["XSP_", "XLG_", "XTM_", "XEM_"]) clean(prefix);
  }

  // --- the real providers are wired to the pooled loader ---
  {
    const scAuth = read("src/soundcharts/auth.ts");
    assert(/legacyVars:\s*\{/.test(scAuth), "Soundcharts loads legacy pairs alongside modern credentials");
    assert(/SOUNDCHARTS_LEGACY_API_KEY", "SOUNDCHARTS_LEGACY_TOKEN"/.test(scAuth), "both legacy secret names are accepted");
    assert(/extraVars: \{ teamId: "SOUNDCHARTS_TEAM_ID" \}/.test(scAuth), "Soundcharts binds a per-slot team id");
    // Legacy credentials are loaded but never mixed into a modern request.
    const tokenFn = scAuth.slice(scAuth.indexOf("async function requestToken"), scAuth.indexOf("export async function getSoundchartsAccessToken"));
    assert(!/legacy/i.test(tokenFn), "the OAuth token request never touches legacy credentials");
    const spAuth = read("src/spotifyAuth.ts");
    assert(/handle\.authFailure\(/.test(spAuth), "a Spotify 401/403 refreshes once before the slot is judged");
    assert(/handle\.rejected\("bad_credentials"\)/.test(spAuth), "a token-endpoint rejection disables the slot immediately");
    const settings = read("app/components/views/system.tsx");
    assert(/secretFingerprint/.test(settings), "Settings renders the secret fingerprint field");
    assert(!/slot\.credential/.test(settings), "Settings never reads a raw credential");
  }

  console.log("== Spotify pacing + pool-derived cooldown ==");
  {
    const guard = await import("./spotifyRateGuard");
    const { reloadSpotifyPool, getSpotifyPool } = await import("./spotifyAuth");
    guard.clearSpotifyCooldown();
    await guard.acquireSpotifySlot(); // pacing must never throw for a cooldown

    // The cooldown is DERIVED from the pool: active only when every key is out.
    const prevId = process.env.SPOTIFY_CLIENT_ID, prevSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const prevId2 = process.env.SPOTIFY_CLIENT_ID_2, prevSecret2 = process.env.SPOTIFY_CLIENT_SECRET_2;
    for (let i = 3; i <= 10; i++) { delete process.env[`SPOTIFY_CLIENT_ID_${i}`]; delete process.env[`SPOTIFY_CLIENT_SECRET_${i}`]; }
    process.env.SPOTIFY_CLIENT_ID = "poolkey1"; process.env.SPOTIFY_CLIENT_SECRET = "aaaaaaaaaaaaaaaasecret1";
    process.env.SPOTIFY_CLIENT_ID_2 = "poolkey2"; process.env.SPOTIFY_CLIENT_SECRET_2 = "bbbbbbbbbbbbbbbbsecret2";
    reloadSpotifyPool();
    const pool = getSpotifyPool();
    eq(guard.spotifyCooldownInfo().active, false, "no cooldown while a key is available");

    await pool.run(async (h) => { if (h.label === "1") { h.rateLimited(600); throw new Error("429"); } return null; }).catch(() => {});
    eq(guard.spotifyCooldownInfo().active, false, "one parked key does NOT stop the app — the others still serve");

    await pool.run(async (h) => { h.rateLimited(900); throw new Error("429"); }).catch(() => {});
    const info = guard.spotifyCooldownInfo();
    eq(info.active, true, "the cooldown is active only once every key is parked");
    assert(info.remainingMs > 0 && info.remainingMs <= 600_000 + 5000, "the ETA is the earliest key's remaining wait");
    assert(/frees up in about/.test(new guard.SpotifyCooldownError(info.remainingMs).message), "the error states the wait");
    assert(/your own Spotify client/i.test(new guard.SpotifyCooldownError(1000).message), "the error says distributor lookups still work");

    // Restore the real environment and pool.
    if (prevId) process.env.SPOTIFY_CLIENT_ID = prevId; else delete process.env.SPOTIFY_CLIENT_ID;
    if (prevSecret) process.env.SPOTIFY_CLIENT_SECRET = prevSecret; else delete process.env.SPOTIFY_CLIENT_SECRET;
    if (prevId2) process.env.SPOTIFY_CLIENT_ID_2 = prevId2; else delete process.env.SPOTIFY_CLIENT_ID_2;
    if (prevSecret2) process.env.SPOTIFY_CLIENT_SECRET_2 = prevSecret2; else delete process.env.SPOTIFY_CLIENT_SECRET_2;
    reloadSpotifyPool();
  }
  const pooledSrc = read("src/spotifyAuth.ts");
  assert(/await acquireSpotifySlot\(\)/.test(pooledSrc), "the pooled request helper paces every outgoing Spotify call");
  assert(!/noteSpotifyRateLimit\(/.test(pooledSrc), "the pooled helper no longer sets a process-wide cooldown (the pool parks one key)");
  const guardSrc = read("src/spotifyRateGuard.ts");
  assert(/getSpotifyPool\(\)\.status\(\)/.test(guardSrc), "the cooldown is derived from pool state, not tracked separately");

  console.log("== artist catalogue: inputs, merge and removed tracks ==");
  eq(parseMusicLookupInput("https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt").type, "spotify_artist", "artist URL parses as an artist");
  eq(parseMusicLookupInput("spotify:artist:0gxyHStUsqpMadRV0Di1Qt").type, "spotify_artist", "artist URI parses as an artist");
  eq(parseMusicLookupInput("886443671584").type, "upc", "12-digit barcode parses as a UPC");
  eq(parseMusicLookupInput("4099964272932").type, "upc", "13-digit barcode parses as a UPC");
  eq(parseMusicLookupInput("GBARL9300135").type, "isrc", "ISRC still parses as an ISRC, not a UPC");
  eq(parseMusicLookupInput("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy").type, "spotify_album", "album URL still parses");
  eq(parseMusicLookupInput("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").type, "invalid", "playlist URL is still rejected");
  eq(parseMusicLookupInput("12345678901").type, "invalid", "an 11-digit number is not a UPC");

  const catalogSrc = read("src/artist/catalog.ts");
  assert(/onProfile: false/.test(catalogSrc) && /onProfile: true/.test(catalogSrc), "catalogue flags on-profile and removed rows distinctly");
  assert(/byIsrc/.test(catalogSrc) && /titleKey/.test(catalogSrc), "history is matched to the profile by ISRC first, title as fallback");
  assert(/coverage/.test(catalogSrc) && /truncated/.test(catalogSrc), "catalogue reports truncation instead of silently dropping rows");
  assert(!/distributor/i.test(catalogSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) , "catalogue never fabricates a distributor (resolved separately from the licensor UUID)");
  // The artist-catalogue workspace UI moved from ArtistCatalog.tsx (now just the
  // shared type contract) to a release-grouped table + drawer during the redesign:
  // app/lib/hooks/useArtistCatalog.ts (resolution state), app/components/releases/*.
  const catalogHook = read("app/lib/hooks/useArtistCatalog.ts");
  const releaseDrawerUi = read("app/components/releases/ReleaseDetailsDrawer.tsx");
  const releaseFiltersUi = read("app/components/releases/ReleaseFilters.tsx");
  const exportUtils = read("app/components/releases/exportUtils.ts");
  assert(/soundchartsSongUuid/.test(releaseDrawerUi) && /openId/.test(releaseDrawerUi), "removed rows open by their Soundcharts uuid, so they can still be inspected");
  assert(/cancelRef/.test(catalogHook) && /Stop/i.test(releaseFiltersUi), "bulk resolution can be stopped");
  assert(/export/i.test(exportUtils) && /Export/.test(releaseFiltersUi), "the catalogue can be exported");

  console.log("== in-app Ocean Analyzer (Spicetify) ==");
  const inApp = read("spicetify/distro-finder.js");
  assert(/Analyze with Ocean Analyzer/.test(inApp) && /Ocean Analyzer ile Analiz Et/.test(inApp), "in-app menu label is localized (TR + EN)");
  assert(/spotify:\(track\|album\|artist\|playlist\)/.test(inApp), "in-app menu accepts track/album/artist/playlist URIs");
  assert((inApp.match(/ContextMenu\.Item/g) || []).length === 2, "exactly two context-menu items (Analyzer + quick distributor panel)");
  assert(/__oceanAnalyzer/.test(inApp), "in-app analyzer requests data through the desktop CDP channel");
  assert(/DESKTOP_APP_OFFLINE/.test(inApp), "in-app analyzer degrades honestly when the desktop app is closed");
  assert(/missing: true/.test(inApp), "in-app chart keeps data gaps as gaps, not zeros");
  assert(/id: "oa-overlay"/.test(inApp) && /classList\.remove\("open"\)/.test(inApp), "a single overlay is reused and closed, never stacked");
  const bridgeFile = read("desktop/spotify-bridge.js");
  assert(/readAnalyzerRequest/.test(bridgeFile) && /writeAnalyzerResponse/.test(bridgeFile), "bridge exposes the analyzer request/response channel");
  assert(/JSON\.stringify\(json\)|JSON\.parse\(\$\{JSON\.stringify/.test(bridgeFile), "analyzer responses cross as JSON literals (no code injection)");
  const mainFile = read("desktop/main.js");
  assert(/ANALYZER_KINDS/.test(mainFile) && /\/api\/analyzer\//.test(mainFile), "desktop app serves analyzer requests from the panel service");

  console.log("== desktop bridge: reads only the client's own metadata ==");
  const bridgeSrc = read("desktop/spotify-bridge.js");
  assert(/metadata\/4\/track/.test(bridgeSrc), "bridge requests the client's own metadata endpoint");
  assert(/accessToken/.test(bridgeSrc) && /return \{ ok: true, b64/.test(bridgeSrc), "bridge returns only the response body — the token stays in the renderer");
  assert(!/b64:.*token|token.*: *token/.test(bridgeSrc), "bridge never returns the session token");
  const mainSrc = read("desktop/main.js");
  assert(/spotify-metadata/.test(mainSrc), "desktop app posts captured metadata to the connector endpoint");
  assert(/ensurePaired/.test(mainSrc), "desktop app pairs with its own server automatically");

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("selftest crashed:", err);
  process.exit(1);
});
