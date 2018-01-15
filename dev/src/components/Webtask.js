const //
  discogsCollection = `https://wt-3cbd5efe1e55015be8738859f4791dfe-0.run.webtask.io/discogs-collection`,
  discogsReleases = `https://wt-3cbd5efe1e55015be8738859f4791dfe-0.run.webtask.io/discogs-releases`,
  spotifySearch =
    'https://wt-3cbd5efe1e55015be8738859f4791dfe-0.run.webtask.io/spotify-search';

export default class Webtask {
  constructor() {}

  searchSpotify(artist, album) {
    return new Promise((resolve, reject) => {
      let query = `${album} artist:${artist}`;
      axios
        .get(spotifySearch, { params: { album: query } })
        .then(data => {
          resolve(data);
        })
        .catch(reject);
    });
  }

  getCollection() {
    return new Promise((resolve, reject) => {
      axios
        .get(discogsCollection, { params: { full: true } })
        .then(resolve)
        .catch(reject);
    });
  }

  getReleases(idsString) {
    return new Promise((resolve, reject) => {
      axios
        .get(discogsReleases, { params: { ids: idsString } })
        .then(resolve)
        .catch(reject);
    });
  }
}