import angular from 'angular';
import deepmerge from 'deepmerge';
import getFilePath from 'wikimedia-commons-file-path';

import {CommonsFile, CommonsTitle, LatLng} from '../model';

export const API_URL = 'https://commons.wikimedia.org/w/api.php';
const NS_FILE = 6;
const NS_CATEGORY = 14;
const maxTitlesPerRequest = 50;

interface ApiResponse<P = never> {
  continue: {[key: string]: string} | undefined;
  batchcomplete: string;
  query: {
    pages: {[key: string]: P};
    categorymembers?: P[];
    allpages?: P[];
  };
}

interface Page {
  pageid: number;
  ns: number;
  title: string;
}

interface CoordinatePage {
  pageid: number;
  ns: number;
  title: string;
  coordinates?: Coordinate[];
}

interface Coordinate {
  lat: number;
  lon: number;
  primary?: string;
  type: 'camera' | 'object';
}

interface DetailsPage {
  pageid: number;
  ns: number;
  title: string;
  categories?: Category[];
  imagerepository: string;
  imageinfo: ImageInfo[];
  revisions?: Revision[];
}

interface Category {
  ns: number;
  title: string;
}

interface ImageInfo {
  url: string;
  descriptionurl: string;
  descriptionshorturl: string;
  extmetadata: ExtMetadata;
}

interface ExtMetadata {
  ImageDescription: Artist;
  DateTimeOriginal: Artist;
  Artist: Artist;
}

interface Artist {
  value: string;
  source: string;
}

interface Revision {
  slots: Slots;
}

export interface Slots {
  main: MainSlot;
}

export interface MainSlot {
  contentformat: string;
  contentmodel: string;
  '*': string;
}

export default class LtData {
  public static $inject = [
    '$http',
    '$httpParamSerializer',
    '$sce',
    '$q',
    'gettextCatalog',
    'limitToFilter'
  ];
  constructor(
    private $http: ng.IHttpService,
    private $httpParamSerializer: ng.IHttpParamSerializer,
    private $sce: ng.ISCEService,
    private $q: ng.IQService,
    private gettextCatalog: gettextCatalog,
    private limitToFilter: ng.IFilterLimitTo
  ) {}

  getCoordinates(titles: CommonsTitle[]): ng.IPromise<CommonsFile[]> {
    if (angular.isString(titles)) {
      titles = titles.split('|');
    }
    if (titles.length > maxTitlesPerRequest) {
      return this.getCoordinatesChunkByChunk(titles);
    }
    const params = {
      prop: 'coordinates',
      colimit: 500,
      coprop: 'type|name',
      coprimary: 'all',
      titles: titles.join('|').replace(/_/g, ' ')
    };
    return this.$query<ApiResponse<CoordinatePage>>(params).then(data => {
      const pages = data?.query?.pages || {};
      return Object.entries(pages).map(([pageid, page]) => {
        const coordinates = page.coordinates || [];
        return {
          pageid: parseInt(pageid),
          file: page.title,
          url: `https://commons.wikimedia.org/wiki/${page.title}`,
          imageUrl(width?: number) {
            return getFilePath(this.file, width);
          },
          coordinates: new LatLng(
            'Location',
            ...toLatLng(coordinates.filter(c => c.primary === '' && c.type === 'camera'))
          ),
          objectLocation: new LatLng(
            'Object location',
            ...toLatLng(coordinates.filter(c => c.type === 'object'))
          )
        } as CommonsFile;
      });
      function toLatLng(cc: Coordinate[]): [number?, number?] {
        const c: Coordinate = cc?.[0];
        return angular.isObject(c) ? [c.lat, c.lon] : [undefined, undefined];
      }
    });
  }

  getCoordinatesChunkByChunk(titles: CommonsTitle[]): ng.IPromise<CommonsFile[]> {
    const t = [...titles];
    const requests: CommonsTitle[][] = [];
    while (t.length) {
      requests.push(t.splice(0, Math.min(maxTitlesPerRequest, t.length)));
    }
    const coordinatesPromises = requests.map(x => this.getCoordinates(x));
    return this.$q.all(coordinatesPromises).then(x => flatten(x));

    function flatten<T>(array: T[][]) {
      const result: T[] = [];
      return result.concat(...array);
    }
  }

  getFileDetails(pageid: number): ng.IPromise<{
    categories: string[];
    description: string;
    author: string;
    timestamp: string;
    url: string;
    objectLocation: LatLng;
  }> {
    const params = {
      prop: 'categories|imageinfo|revisions',
      clshow: '!hidden',
      pageids: pageid,
      iiprop: 'url|extmetadata',
      iiextmetadatafilter: 'ImageDescription|Artist|DateTimeOriginal',
      iiextmetadatalanguage: this.gettextCatalog.getCurrentLanguage(),
      rvslots: 'main',
      rvprop: 'content'
    };
    return this.$query<ApiResponse<DetailsPage>>(params).then(data => {
      const page: DetailsPage | undefined = data?.query?.pages?.[pageid];
      const categories = (page?.categories || []).map(category =>
        category.title.replace(/^Category:/, '')
      );
      return {
        categories,
        description: this.$sce.trustAsHtml(
          page?.imageinfo?.[0]?.extmetadata?.ImageDescription?.value
        ),
        author: this.$sce.trustAsHtml(page?.imageinfo[0]?.extmetadata?.Artist?.value),
        timestamp: this.$sce.trustAsHtml(page?.imageinfo[0]?.extmetadata?.DateTimeOriginal?.value),
        url: page?.imageinfo[0]?.descriptionurl,
        objectLocation: extractObjectLocation(page)
      };
    });

    function extractObjectLocation(page: DetailsPage) {
      try {
        const wikitext: string = page?.revisions?.[0]?.slots?.main['*'] || '';
        const locDeg = wikitext.match(
          /\{\{Object location( dec)?\|([0-9]+)\|([0-9]+)\|([0-9.]+)\|([NS])\|([0-9]+)\|([0-9]+)\|([0-9.]+)\|([WE])/i
        );
        const loc = wikitext.match(/\{\{Object location( dec)?\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)/i);
        let lat;
        let lng;
        if (locDeg) {
          lat = parseInt(locDeg[2]) + parseInt(locDeg[3]) / 60 + parseFloat(locDeg[4]) / 3600;
          lat *= locDeg[5] === 'N' ? 1 : -1;
          lng = parseInt(locDeg[6]) + parseInt(locDeg[7]) / 60 + parseFloat(locDeg[8]) / 3600;
          lng *= locDeg[9] === 'E' ? 1 : -1;
        } else if (loc) {
          lat = parseFloat(loc[2]);
          lng = parseFloat(loc[3]);
        }
        return new LatLng('Object location', lat, lng);
      } catch (e) {
        return new LatLng('Object location', undefined, undefined);
      }
    }
  }

  getCategoriesForPrefix(prefix: string): ng.IPromise<CommonsTitle[]> {
    const params = {
      list: 'allpages',
      apnamespace: NS_CATEGORY,
      aplimit: 30,
      apfrom: prefix,
      apprefix: prefix
    };
    return this.$query<ApiResponse<Page>>(params, {}, undefined, () => false).then(data =>
      (data.query.allpages || []).map(i => i.title.replace(/^Category:/, '' as CommonsTitle))
    );
  }

  getFiles({
    files,
    user,
    userLimit,
    userStart,
    userEnd,
    category,
    categoryDepth
  }: {
    files: CommonsTitle[];
    user: string;
    userLimit: string | number | undefined;
    userStart: string | undefined;
    userEnd: string | undefined;
    category: string;
    categoryDepth: string | number | undefined;
  }): ng.IPromise<CommonsTitle[]> {
    return this.$q((resolve, reject) => {
      if (files) {
        resolve(files);
      } else if (user) {
        userLimit = typeof userLimit === 'string' ? +userLimit : userLimit;
        this.getFilesForUser(user, userLimit, userStart, userEnd).then(resolve);
      } else if (category) {
        categoryDepth = typeof categoryDepth === 'string' ? +categoryDepth : categoryDepth;
        this.getFilesForCategory(category, categoryDepth).then(resolve);
      } else {
        reject();
      }
    });
  }

  private removeCommonsPrefix(string: string, prefix: string): string {
    const urlPrefix = 'https://commons.wikimedia.org/wiki/';
    if (string.indexOf(urlPrefix) === 0) {
      string = string.slice(urlPrefix.length);
      string = decodeURI(string);
    }
    if (string.indexOf(prefix) === 0) {
      string = string.slice(prefix.length);
    }
    return string;
  }

  getFilesForUser(
    user: string,
    userLimit: number | undefined,
    userStart: string | undefined,
    userEnd: string | undefined
  ): ng.IPromise<CommonsTitle[]> {
    user = this.removeCommonsPrefix(user, 'User:');
    // https://commons.wikimedia.org/w/api.php?action=help&modules=query%2Ballimages
    const params = {
      generator: 'allimages',
      gaiuser: user,
      gailimit: typeof userLimit === 'number' && userLimit <= 500 ? userLimit : 'max',
      gaistart: userEnd, // sic! (due to gaidir)
      gaiend: userStart, // sic! (due to gaidir)
      gaisort: 'timestamp',
      gaidir: 'older'
    };
    const toPageArray = (data: ApiResponse<Page>): Page[] => Object.values(data.query.pages);
    const shouldContinue = (data: ApiResponse<Page>): boolean =>
      data.continue ? !userLimit || toPageArray(data).length < userLimit : false;
    return this.$query<ApiResponse<Page>>(params, {}, undefined, shouldContinue)
      .then(data => toPageArray(data).map(page => page.title as CommonsTitle))
      .then(pages => (userLimit ? this.limitToFilter(pages, userLimit) : pages));
  }

  getFilesForCategory(cat: string, depth = 3): ng.IPromise<CommonsTitle[]> {
    cat = this.removeCommonsPrefix(cat, 'Category:');
    const timeout = this.$q.defer();
    const requests = [
      this.getFilesForCategory1(cat, depth, timeout.promise),
      this.getFilesForCategory3(cat, depth, timeout.promise)
    ];
    if (depth <= 0) {
      requests.unshift(this.getFilesForCategory0(cat, timeout.promise));
    }
    return this.successRace(requests).finally(() => timeout.resolve());
  }

  getFilesForCategory0(cat: string, timeout: ng.IPromise<unknown>): ng.IPromise<CommonsTitle[]> {
    const params = {
      list: 'categorymembers',
      cmlimit: 500,
      cmnamespace: NS_FILE,
      cmtitle: 'Category:' + cat
    };
    return this.$query<ApiResponse<Page>>(params, {}, timeout).then(data =>
      (data.query.categorymembers || []).map(cm => cm.title)
    );
  }

  getFilesForCategory1(
    cat: string,
    depth: number,
    timeout: ng.IPromise<unknown>
  ): ng.IPromise<CommonsTitle[]> {
    const params = {
      lang: 'commons',
      cat: cat.replace(/^Category:/, ''),
      type: NS_FILE,
      depth: depth,
      json: 1
    };
    return this.$http
      .get<CommonsTitle[]>('https://cats-php.toolforge.org/', {params, timeout})
      .then(d => d.data.map(f => `File:${f}`));
  }

  getFilesForCategory3(
    categories: string,
    depth: number,
    timeout: ng.IPromise<unknown>
  ): ng.IPromise<CommonsTitle[]> {
    const params = {
      language: 'commons',
      project: 'wikimedia',
      depth,
      categories,
      [`ns[${NS_FILE}]`]: 1,
      format: 'json',
      sparse: 1,
      doit: 1
    };
    return (
      this.$http
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .get<any>('https://petscan.wmflabs.org/', {params, timeout})
        .then(d => d.data['*'][0]['a']['*'] as CommonsTitle[])
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private $query<T extends ApiResponse<any>>(
    query: Record<string, unknown>,
    previousResults = {},
    timeout?: ng.IPromise<unknown>,
    shouldContinue = (data: T) => !!data.continue
  ): ng.IPromise<T> {
    const data = this.$httpParamSerializer(query);
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    } as angular.IHttpRequestConfigHeaders;
    const params = {
      action: 'query',
      format: 'json',
      origin: '*'
    };
    return this.$http
      .post<T>(API_URL, data, {
        timeout,
        headers,
        params
      })
      .then(d => d.data)
      .then(
        data => deepmerge(previousResults, data, {arrayMerge: (x, y) => [].concat(...x, ...y)}) as T
      )
      .then(data =>
        shouldContinue(data)
          ? this.$query<T>(
              {...query, continue: undefined, ...data.continue},
              {...data, continue: undefined},
              timeout,
              shouldContinue
            )
          : data
      );
  }

  private successRace<T>(promises: ng.IPromise<T>[]): ng.IPromise<T> {
    promises = promises.filter(p => !!p);
    return this.$q<T>((resolve, reject) => {
      // resolve first successful one
      promises.forEach(promise => promise.then(resolve));
      // reject when all fail
      this.$q.all(promises).catch(reject);
    });
  }
}
