/**
 * The `behaviorHints.bingeGroup` of a DMM Cast stream that plays a file of one
 * release.
 *
 * Stremio's "Auto play next episode" works from this one string. As an episode
 * starts, stremio-core asks the same addon for the next episode's streams and
 * keeps the first whose bingeGroup equals the playing stream's
 * (`next_stream_update` in `src/models/player.rs`, `Stream::is_binge_match`).
 * With no match, the player drops the viewer on the next episode's stream list
 * instead of playing it.
 *
 * So the group names the release - its hash - and nothing about the episode or
 * the stream's place in the list. Every DMM Cast addon used to build it from
 * the Stremio video id (`tt0903747:1:1`) plus a rank, so no two episodes ever
 * matched (debrid-media-manager#177). A whole-season cast files each episode
 * under the pack's hash, and the shared pool lists a pack's episodes under the
 * same hash, so the next episode of the release being watched carries the same
 * group wherever in the list it lands. A release the next episode does not
 * offer matches nothing, and Stremio shows the list rather than switching to a
 * different release.
 */
export function releaseBingeGroup(
	addon: 'dmm' | 'dmm-tb' | 'dmm-ad' | 'dmm-pm' | 'dmm-oc' | 'dmm-dl',
	hash: string | null | undefined
): string | undefined {
	const release = hash?.trim().toLowerCase();
	// Without a hash there is no release to continue, and a shared empty group
	// would chain unrelated hashless rows together.
	return release ? `${addon}:${release}` : undefined;
}
