import Firestore from './Firestore';
import Renderer from '../renderers/Renderer';
import Webtask from './Webtask';

const LOCAL_KEY = 'discogs-library-0.1',
  BATCH_SIZE = 10,
  BATCH_SECONDS = 15;

export default class Store {
  constructor(database, app) {
    this.localKey = LOCAL_KEY;
    this.app = app;
    this.firestore = new Firestore(database);
    this.webtask = new Webtask();
    this.renderer = new Renderer(this);
  }

  searchSpotifyForRelease(artist, album) {
    return new Promise((resolve, reject) => {
      this.webtask
        .searchSpotify(artist, album)
        .then(resolve)
        .catch(reject);
    });
  }

  loadAllDataFromLocalStorage() {
    let localData = this._getStore();
    if (localData) {
      this.setData(JSON.parse(localData));
      return true;
    } else {
      return false;
    }
  }

  getAllDataFromFirebase() {
    return new Promise((resolve, reject) => {
      this.renderer.loading.enable();
      this.renderer.loading.message('Getting Collection from Database');
      this.firestore
        .getAllData()
        .then(data => {
          this.setData(data);
          this.renderer.loading.disable();
          resolve();
        })
        .catch(reject);
    });
  }

  loadAllDataFromJSON() {
    return new Promise((resolve, reject) => {
      this.renderer.loading.enable();
      this.renderer.loading.message('Loading Data');
      axios
        .get(`data/${LOCAL_KEY}.json`, {})
        .then(data => {
          this.setData(data.data);
          this.renderer.loading.disable();
          resolve();
        })
        .catch(reject);
    });
  }

  updateCollection() {
    this.renderer.loading.enable();
    this.renderer.loading.message('Getting Collection from Discogs');
    return new Promise((resolve, reject) => {
      this.webtask
        .getCollection()
        .then(data => {
          this.renderer.loading.message('Writing Collection to Database');
          this.firestore
            .writeCollection(data)
            .then(data => {
              this.renderer.loading.message('Wrote Collection to Database');
              this._clearStore();
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    });
  }

  setData({ user, collection, releases }) {
    this._ = {
      user,
      releases,
      collectionFolders: collection.folders,
      collectionReleases: collection.releases,
      missingReleaseIds: []
    };
    Object.keys(this._.collectionReleases).forEach(releaseId => {
      if (!this._.releases[releaseId]) this._.missingReleaseIds.push(releaseId);
    });
    this._setStore({ user, collection, releases });
  }

  loadMissingReleases() {
    // "Loading" state of app with progress notifications
    this.renderer.loading.enable();
    this.renderer.loading.message(
      `Loading ${this._.missingReleaseIds.length} Releases from Discogs.`
    );
    return new Promise((resolve, reject) => {
      let ids = this._.missingReleaseIds,
        chunkedIds = [],
        // If we can, we do it all at once, otherwise we throttle to 10 per 15 seconds
        size = ids.length <= 60 ? 60 : BATCH_SIZE;
      while (ids.length > 0) chunkedIds.push(ids.splice(0, size));
      let chunks = chunkedIds.length,
        time = this._time(chunks * BATCH_SECONDS);
      this.renderer.loading.message(
        `This will take around ${time} in ${chunks} pass(es).`
      );
      // Get Release(s) from Webtask and progressively Write Release(s) to Firestore
      this.loadReleases(chunkedIds, chunks, 0)
        .then(() => {
          this.renderer.loading.message(`Completed ${chunks} pass(es)`);
          // Delete localStorage
          this._clearStore();
          resolve();
        })
        .catch(reject);
    });
  }

  updateRelease(id) {
    this.renderer.loading.enable();
    return new Promise((resolve, reject) => {
      this.loadReleases([[id]], 1, 0)
        .then(response => {
          this._.releases[id] = response.data[id];
          let { releases, user } = this._,
            collection = {
              releases: this._.collectionReleases,
              folders: this._.collectionFolders
            };
          this._setStore({ user, collection, releases });
          this.renderer.loading.disable();
          resolve();
        })
        .catch(reject);
    });
  }

  // Recursively loading 60 releases/minute from Webtask then writing to Firestore.
  loadReleases(chunkedIds, chunks, index) {
    let count = chunkedIds[index].length,
      ids = chunkedIds[index].join(',');
    return new Promise((resolve, reject) => {
      this.webtask
        .getReleases(ids)
        .then(data => {
          index++;
          let time = this._time((chunks - index + 1) * BATCH_SECONDS);
          this.renderer.loading.message(
            `Got ${index}/${chunks} batches of Releases from Discogs. ~${time} remaining.`
          );
          // If we need to get more
          if (index < chunks) {
            // Write existing to Firebase (will load on window.reload later)
            this.firestore
              .writeReleases(data)
              .then(() => {
                this.renderer.loading.message(
                  `Wrote ${count} Releases to Database.`
                );
              })
              .catch(reject);
            // Queue it again with the next batch
            setTimeout(() => {
              resolve(this.loadReleases(chunkedIds, chunks, index));
            }, 1000 * BATCH_SECONDS);
          } else {
            // We have what we need
            // Write existing to Firebase (will load on window.reload later)
            this.firestore
              .writeReleases(data)
              .then(() => {
                this.renderer.loading.message(
                  `Wrote ${count} Releases to Database.`
                );
                // Resolve
                resolve(data);
              })
              .catch(reject);
          }
        })
        .catch(reject);
    });
  }

  process() {
    this.searchable = Object.values(this._.collectionReleases).map(
      this._searchableRelease.bind(this)
    );
    this._categorizeReleases(this._.collectionReleases);
    this.fuseSearch = new Fuse(this.searchable, {
      shouldSort: true,
      includeMatches: true,
      tokenize: true,
      matchAllTokens: true,
      findAllMatches: true,
      threshold: 0.3,
      location: 0,
      distance: 100,
      maxPatternLength: 32,
      minMatchCharLength: 3,
      keys: ['artistTitle']
    });
    this.randomRelease();
  }

  randomRelease() {
    let ids = Object.keys(this._.releases),
      id = ids[Math.floor(Math.random() * ids.length)];
    this.renderer.release.render(id);
  }

  search(term) {
    if (!this.fuseSearch) return null;
    if (!term) return null;
    return this.fuseSearch.search(term);
  }

  _time(seconds) {
    let minutes = Math.floor(seconds / 60);
    seconds = seconds - minutes * 60;
    minutes = minutes < 10 ? `0${minutes}` : minutes;
    seconds = seconds < 10 ? `0${seconds}` : seconds;
    return `${minutes}:${seconds}`;
  }

  _getStore() {
    return localStorage.getItem(LOCAL_KEY);
  }

  _setStore(data) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  }

  _clearStore() {
    localStorage.removeItem(LOCAL_KEY);
  }

  _searchableRelease(collectionRelease) {
    let release = this._.releases[collectionRelease.id],
      response = {};
    response.id = release.id;
    response.title = release.title;
    response.year = release.year;
    response.artist = Object.values(release.artists)
      .map(a => a.name)
      .join(', ');
    response.artistTitle = response.artist + ': ' + response.title;
    response.folder = this._.collectionFolders[collectionRelease.folderId].name;
    let formats = {};
    release.formats.forEach(format => (formats[format.name] = 1));
    response.format = Object.keys(formats).join(', ');
    return response;
  }

  _categorizeReleases(collectionReleases) {
    this.categorized = { artist: {}, label: {}, companies: {} };
    Object.values(collectionReleases).forEach(collectionRelease => {
      let release = this._.releases[collectionRelease.id];
      Object.values(release.artists).forEach(artist => {
        let name = artist.name;
        if (name !== 'Various') {
          this.categorized.artist[name] = this.categorized.artist[name] || [];
          this.categorized.artist[name].push(release.id);
        }
      });
      Object.values(release.labels).forEach(label => {
        let name = label.name;
        this.categorized.label[name] = this.categorized.label[name] || [];
        this.categorized.label[name].push(release.id);
      });
      Object.values(release.companies).forEach(company => {
        let name = `${company.type}-${company.name}`;
        this.categorized.companies[name] =
          this.categorized.companies[name] || [];
        this.categorized.companies[name].push(release.id);
      });
    });
  }
}
